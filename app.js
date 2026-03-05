// =====================================
// 1. Module Imports
// =====================================

// Core framework & utilities
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const port = process.env.PORT || 7070;

// MongoDB and middleware
const mongoose = require('mongoose');
const session = require('express-session');
const multer = require('multer');

// =====================================
// 2. App Initialization & Configuration
// =====================================

const app = express();

// Set EJS as the templating engine
app.set('view engine', 'ejs');

// Serve static assets from 'public' and 'uploads' folders
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Parse JSON and form data (URL-encoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add cache control for admin routes
app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// =====================================
// 3. Session Setup
// =====================================

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// =====================================
// 4. Database Connection (MongoDB)
// =====================================

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully');
    initializeSystemSettings();
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// =====================================
// 5. Mongoose Schemas & Models
// =====================================

// For contact messages
const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

// For user profile
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  profession: { type: String, required: true },
  pass: { type: String, required: true },
  passwordChangedAt: { type: Date, default: Date.now },
  profilePicture: {
    filename: String,
    path: String,
    url: String,
    uploadDate: { type: Date, default: Date.now }
  },
  pdfs: [{
    name: String,
    filename: String,
    path: String,
    uploadDate: { type: Date, default: Date.now },
    size: Number
  }],
  images: [{
    name: String,
    filename: String,
    path: String,
    uploadDate: { type: Date, default: Date.now },
    size: Number
  }],
  documents: [{
    name: { type: String },
    filename: { type: String },
    path: { type: String },
    type: { type: String },
    uploadDate: { type: Date, default: Date.now },
    size: { type: Number }
  }],
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// For failed login attempts tracking
const failedLoginSchema = new mongoose.Schema({
  email: { type: String, required: true },
  ip: { type: String, required: true },
  userAgent: { type: String },
  attemptTime: { type: Date, default: Date.now },
  reason: { type: String, enum: ['invalid_password', 'user_not_found', 'admin_credentials'] }
});
const FailedLogin = mongoose.model('FailedLogin', failedLoginSchema);

// =====================================
// For user activities tracking
// =====================================
const activitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  description: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed },
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now }
});
const Activity = mongoose.model('Activity', activitySchema);

// =====================================
// System Settings Model
// =====================================
const systemSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String }
});

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

// =====================================
// Activity Logging Helper
// =====================================
async function logActivity(userId, type, description, metadata = {}, req = null) {
  try {
    const activity = new Activity({
      userId,
      type,
      description,
      metadata,
      ip: req ? req.ip : null,
      userAgent: req ? req.get('User-Agent') : null
    });
    await activity.save();
    
    // Keep only last 50 activities per user (optional cleanup)
    const count = await Activity.countDocuments({ userId });
    if (count > 50) {
      const oldest = await Activity.findOne({ userId }).sort({ createdAt: 1 });
      if (oldest) await Activity.deleteOne({ _id: oldest._id });
    }
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Initialize default settings
async function initializeSystemSettings() {
  try {
    const registrationEnabled = await SystemSettings.findOne({ key: 'registration_enabled' });
    if (!registrationEnabled) {
      await SystemSettings.create({
        key: 'registration_enabled',
        value: true,
        updatedBy: 'system'
      });
      console.log('✅ Initialized system settings: registration_enabled = true');
    }
    
    // make sure maintenance flag exists
    const maintenanceEnabled = await SystemSettings.findOne({ key: 'maintenance_enabled' });
    if (!maintenanceEnabled) {
      await SystemSettings.create({
        key: 'maintenance_enabled',
        value: false,
        updatedBy: 'system'
      });
      console.log('✅ Initialized system settings: maintenance_enabled = false');
    }
  } catch (error) {
    console.error('Error initializing system settings:', error);
  }
}

// =====================================
// 5.5 Maintenance Mode Middleware (FIXED - allows admin access after bypass)
// =====================================
app.use(async (req, res, next) => {
  // Skip maintenance check for static files and essential routes
  if (req.path.startsWith('/uploads') || 
      req.path.startsWith('/css') || 
      req.path.startsWith('/js') || 
      req.path === '/admin-login-bypass' ||
      req.path === '/admin_login_bypass' ||
      req.path === '/admin/debug-maintenance' ||
      req.path === '/api/registration-status' ||
      req.path === '/favicon.ico') {
    return next();
  }

  try {
    // Check if maintenance mode is enabled
    const maintenanceSetting = await SystemSettings.findOne({ key: 'maintenance_enabled' });
    const maintenanceEnabled = maintenanceSetting ? maintenanceSetting.value : false;
    
    if (maintenanceEnabled) {
      // Check if user is an authenticated admin (has admin session)
      const isAuthenticatedAdmin = req.session.isAdmin && req.session.adminEmail === process.env.ADMIN_EMAIL;
      
      // Allow admin to access admin routes if they're authenticated
      if (isAuthenticatedAdmin && req.path.startsWith('/admin')) {
        console.log(`🔓 Authenticated admin accessing ${req.path} during maintenance`);
        return next();
      }
      
      // Log the blocked access attempt
      console.log(`🚫 Maintenance mode active - blocked access for: ${req.path} (User: ${req.session?.isAdmin ? 'Admin (unauthenticated)' : 'Regular'})`);
      
      // If someone tries to access admin routes during maintenance without auth, redirect to bypass
      if (req.path.startsWith('/admin')) {
        return res.redirect('/admin-login-bypass');
      }
      
      // For all other routes, show maintenance page
      return res.status(503).render('maintenance', {
        title: 'Under Maintenance',
        message: 'We are currently performing scheduled maintenance. Please check back soon.',
        currentUser: null
      });
    }
    
    next();
  } catch (error) {
    console.error('Maintenance mode check error:', error);
    next();
  }
});

// =====================================
// 6. File Upload Configurations (Multer)
// =====================================

// File filter functions
const fileFilter = (req, file, cb) => {
  file.mimetype === 'application/pdf'
    ? cb(null, true)
    : cb(new Error('Only PDF files are allowed'), false);
};

const imageFileFilter = (req, file, cb) => {
  file.mimetype.startsWith('image/')
    ? cb(null, true)
    : cb(new Error('Only image files are allowed'), false);
};

const officeFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, Word, Excel, and PowerPoint files are allowed'), false);
  }
};

// PDF Upload Setup
const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/pdfs/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage: pdfStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Image Upload Setup
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/images/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Profile Picture Upload Setup
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/profile-pictures/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadProfile = multer({
  storage: profileStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Office Files Upload Setup
const officeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/documents/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadOffice = multer({
  storage: officeStorage,
  fileFilter: officeFileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// =====================================
// 7. Upload & Deletion Routes
// =====================================

// PDF Upload
app.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const newPdf = {
      name: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size
    };

    await User.findByIdAndUpdate(req.session.userId, { $push: { pdfs: newPdf } });

    await logActivity(
      req.session.userId,
      'file_upload',
      `Uploaded PDF: ${req.file.originalname}`,
      { 
        filename: req.file.filename,
        fileType: 'pdf',
        size: req.file.size,
        originalName: req.file.originalname
      },
      req
    );

    res.status(201).json({ message: 'File uploaded successfully', filename: req.file.filename });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Error uploading file' });
  }
});

// PDF Delete
app.delete('/delete-pdf/:userId/:filename', async (req, res) => {
  try {
    const { userId, filename } = req.params;
    if (req.session.userId !== userId) return res.status(403).json({ message: 'Unauthorized' });

    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(__dirname, 'uploads', 'pdfs', sanitizedFilename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' });

    const user = await User.findById(userId);
    const fileInfo = user.pdfs.find(p => p.filename === sanitizedFilename);
    
    await fs.promises.unlink(filePath);
    await User.findByIdAndUpdate(userId, { $pull: { pdfs: { filename: sanitizedFilename } } });

    await logActivity(
      userId,
      'file_delete',
      `Deleted PDF: ${fileInfo?.name || sanitizedFilename}`,
      { 
        filename: sanitizedFilename,
        fileType: 'pdf',
        originalName: fileInfo?.name
      },
      req
    );

    res.json({ success: true, message: 'PDF deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Image Upload
app.post('/upload-image', uploadImage.single('image'), async (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const newImage = {
      name: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size
    };

    await User.findByIdAndUpdate(req.session.userId, { $push: { images: newImage } });

    await logActivity(
      req.session.userId,
      'file_upload',
      `Uploaded Image: ${req.file.originalname}`,
      { 
        filename: req.file.filename,
        fileType: 'image',
        size: req.file.size,
        originalName: req.file.originalname
      },
      req
    );

    res.status(201).json({ message: 'Image uploaded successfully', filename: req.file.filename });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Error uploading image' });
  }
});

// Image Delete
app.delete('/delete-image/:userId/:filename', async (req, res) => {
  try {
    const { userId, filename } = req.params;
    if (req.session.userId !== userId) return res.status(403).json({ message: 'Unauthorized' });

    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(__dirname, 'uploads', 'images', sanitizedFilename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' });

    const user = await User.findById(userId);
    const fileInfo = user.images.find(i => i.filename === sanitizedFilename);

    await fs.promises.unlink(filePath);
    await User.findByIdAndUpdate(userId, { $pull: { images: { filename: sanitizedFilename } } });

    await logActivity(
      userId,
      'file_delete',
      `Deleted Image: ${fileInfo?.name || sanitizedFilename}`,
      { 
        filename: sanitizedFilename,
        fileType: 'image',
        originalName: fileInfo?.name
      },
      req
    );

    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Office Documents Upload
app.post('/upload-document', uploadOffice.single('document'), async (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    let fileType = 'pdf';
    const mimeType = req.file.mimetype;
    
    if (mimeType.includes('word')) {
      fileType = 'word';
    } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
      fileType = 'excel';
    } else if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) {
      fileType = 'powerpoint';
    }

    const newDocument = {
      name: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      type: fileType,
      size: req.file.size,
      uploadDate: new Date()
    };

    await User.findByIdAndUpdate(
      req.session.userId, 
      { $push: { documents: newDocument } }
    );

    await logActivity(
      req.session.userId,
      'file_upload',
      `Uploaded Document: ${req.file.originalname}`,
      { 
        filename: req.file.filename,
        fileType: 'document',
        docType: fileType,
        size: req.file.size,
        originalName: req.file.originalname
      },
      req
    );

    res.status(201).json({ 
      message: 'Document uploaded successfully', 
      filename: req.file.filename,
      type: fileType
    });
  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ message: 'Error uploading document' });
  }
});

// Document Delete
app.delete('/delete-document/:userId/:filename', async (req, res) => {
  try {
    const { userId, filename } = req.params;
    if (req.session.userId !== userId) return res.status(403).json({ message: 'Unauthorized' });

    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(__dirname, 'uploads', 'documents', sanitizedFilename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' });

    const user = await User.findById(userId);
    const fileInfo = user.documents.find(d => d.filename === sanitizedFilename);

    await fs.promises.unlink(filePath);
    await User.findByIdAndUpdate(userId, { $pull: { documents: { filename: sanitizedFilename } } });

    await logActivity(
      userId,
      'file_delete',
      `Deleted Document: ${fileInfo?.name || sanitizedFilename}`,
      { 
        filename: sanitizedFilename,
        fileType: 'document',
        docType: fileInfo?.type,
        originalName: fileInfo?.name
      },
      req
    );

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Profile Picture Upload
app.post('/upload-profile-picture', uploadProfile.single('profile'), async (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const user = await User.findById(req.session.userId);

    if (user.profilePicture?.filename) {
      const oldPath = path.join(__dirname, 'uploads', 'profile-pictures', user.profilePicture.filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    user.profilePicture = {
      filename: req.file.filename,
      path: req.file.path,
      url: `/uploads/profile-pictures/${req.file.filename}`,
      uploadDate: new Date()
    };

    await user.save();

    await logActivity(
      req.session.userId,
      'profile_update',
      'Updated profile picture',
      { filename: req.file.filename },
      req
    );

    res.json({ success: true, url: user.profilePicture.url });
  } catch (error) {
    console.error('Profile upload error:', error);
    res.status(500).json({ message: 'Error updating profile' });
  }
});

// Delete Profile Picture
app.delete('/delete-profile-picture/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.session.userId !== userId) return res.status(403).json({ message: 'Unauthorized' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.profilePicture?.filename) {
      const filePath = path.join(__dirname, 'uploads', 'profile-pictures', user.profilePicture.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    user.profilePicture = null;
    await user.save();

    await logActivity(
      userId,
      'profile_update',
      'Removed profile picture',
      {},
      req
    );

    res.json({ success: true, message: 'Profile picture deleted successfully' });
  } catch (error) {
    console.error('Delete profile error:', error);
    res.status(500).json({ message: 'Error deleting profile picture' });
  }
});

// =====================================
// 8. File Access Routes
// =====================================

app.get('/pdfs/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'pdfs', req.params.filename);
  res.sendFile(filePath);
});

app.get('/pdfs/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'pdfs', req.params.filename);
  res.download(filePath);
});

app.get('/images/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'images', req.params.filename);
  res.sendFile(filePath);
});

app.get('/documents/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'documents', req.params.filename);
  res.sendFile(filePath);
});

app.get('/documents/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'documents', req.params.filename);
  res.download(filePath);
});

app.get('/profile-pictures/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', 'profile-pictures', req.params.filename);
  res.sendFile(filePath);
});

// =====================================
// 9. Helper function to log failed login attempts
// =====================================

async function logFailedLogin(email, req, reason) {
  try {
    const failedLogin = new FailedLogin({
      email: email,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      reason: reason
    });
    await failedLogin.save();
    
    console.log(`Failed login attempt: ${email} from ${req.ip} - Reason: ${reason}`);
  } catch (error) {
    console.error('Error logging failed login:', error);
  }
}

// =====================================
// 10. Admin authentication middleware
// =====================================
const requireAdminAuth = (req, res, next) => {
  if (req.session.isAdmin && req.session.adminEmail === process.env.ADMIN_EMAIL) {
    next();
  } else {
    req.session.destroy();
    res.redirect('/admin-login-bypass');
  }
};

// =====================================
// 11. Static Page Rendering Routes
// =====================================

app.get('/', (req, res) => res.render('Home', { title: 'Home' }));
app.get('/privacy', (req, res) => res.render('Privacy', { title: 'Privacy Policy' }));
app.get('/terms', (req, res) => res.render('Terms', { title: 'Terms & Conditions' }));
app.get('/contact', (req, res) => res.render('Contact', { title: 'Contact Us' }));
app.get('/register', (req, res) => res.render('Register', { title: 'Register' }));
app.get('/login', (req, res) => res.render('login', { title: 'Login' }));
app.get('/admin_login', (req, res) => res.render('admin_login', { title: '' }));

// Special admin login bypass page
app.get('/admin-login-bypass', (req, res) => {
  res.render('admin_login_bypass', { 
    title: 'Admin Login - Bypass',
    bypassKey: process.env.ADMIN_BYPASS_KEY 
  });
});

// Admin space route
app.get('/admin_space', requireAdminAuth, async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 }).lean();
    const users = await User.find().sort({ createdAt: -1 }).lean();

    res.render('admin_space', {
      title: 'Admin Dashboard',
      contacts,
      users
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).send('Error loading admin dashboard');
  }
});

// =====================================
// 12. Change Password Route
// =====================================

app.post('/change-password', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New passwords do not match' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (currentPassword !== user.pass) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    user.pass = newPassword;
    user.passwordChangedAt = new Date();
    await user.save();

    await logActivity(
      req.session.userId,
      'password_change',
      'Changed password',
      {},
      req
    );

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =====================================
// 13. Admin Rate Limiter
// =====================================
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later'
});

// =====================================
// 14. Admin Stats API Endpoint
// =====================================

app.get('/admin/stats', requireAdminAuth, async (req, res) => {
  try {
    const users = await User.find().lean();
    
    let totalFiles = 0;
    let pdfCount = 0;
    let imageCount = 0;
    let documentCount = 0;
    
    users.forEach(user => {
      const userPdfCount = user.pdfs ? user.pdfs.length : 0;
      const userImageCount = user.images ? user.images.length : 0;
      const userDocumentCount = user.documents ? user.documents.length : 0;
      
      pdfCount += userPdfCount;
      imageCount += userImageCount;
      documentCount += userDocumentCount;
      totalFiles += userPdfCount + userImageCount + userDocumentCount;
    });
    
    const totalContacts = await Contact.countDocuments();
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedLogins24h = await FailedLogin.countDocuments({
      attemptTime: { $gte: twentyFourHoursAgo }
    });
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const failedLogins1h = await FailedLogin.countDocuments({
      attemptTime: { $gte: oneHourAgo }
    });
    
    const uptimeInSeconds = process.uptime();
    const hours = Math.floor(uptimeInSeconds / 3600);
    const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeInSeconds % 60);
    
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.json({
      totalUsers: users.length,
      totalFiles: totalFiles,
      pdfCount: pdfCount,
      imageCount: imageCount,
      documentCount: documentCount,
      officeFilesCount: documentCount,
      totalContacts: totalContacts,
      failedLogins24h: failedLogins24h,
      failedLogins1h: failedLogins1h,
      systemStatus: {
        database: dbStatus,
        serverUptime: `${hours}h ${minutes}m ${seconds}s`,
        uptimeInSeconds: uptimeInSeconds,
        memoryUsage: process.memoryUsage(),
        lastUpdate: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ message: 'Error fetching stats' });
  }
});

// =====================================
// 15. Admin Activities API Endpoint
// =====================================

app.get('/admin/activities', requireAdminAuth, async (req, res) => {
  try {
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const recentContacts = await Contact.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const recentFailedLogins = await FailedLogin.find()
      .sort({ attemptTime: -1 })
      .limit(10)
      .lean();

    const activities = [];

    recentUsers.forEach(user => {
      activities.push({
        type: 'user_registered',
        title: `New user registered: ${user.name}`,
        user: user.email,
        timestamp: user.createdAt || new Date(),
        data: user
      });
    });

    recentContacts.forEach(contact => {
      activities.push({
        type: 'contact_message',
        title: `Contact message from ${contact.name}: ${contact.subject}`,
        user: contact.email,
        timestamp: contact.createdAt || new Date(),
        data: contact
      });
    });

    recentFailedLogins.forEach(attempt => {
      let reasonText = 'Failed login';
      if (attempt.reason === 'user_not_found') {
        reasonText = 'Failed login: User not found';
      } else if (attempt.reason === 'invalid_password') {
        reasonText = 'Failed login: Invalid password';
      } else if (attempt.reason === 'admin_credentials') {
        reasonText = 'Failed admin login attempt';
      }
      
      activities.push({
        type: 'failed_login',
        title: reasonText,
        user: attempt.email,
        timestamp: attempt.attemptTime || new Date(),
        data: {
          ip: attempt.ip,
          userAgent: attempt.userAgent
        }
      });
    });

    if (req.session.isAdmin) {
      activities.push({
        type: 'admin_login',
        title: 'Admin logged in',
        user: req.session.adminEmail,
        timestamp: new Date(),
        data: { ip: req.ip }
      });
    }

    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentActivities = activities.slice(0, 10);

    res.json(recentActivities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Error fetching activities' });
  }
});

// =====================================
// 16. Admin Deletion Routes
// =====================================

app.delete('/admin/users/:id', requireAdminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.profilePicture?.filename) {
      const profilePath = path.join(__dirname, 'uploads', 'profile-pictures', user.profilePicture.filename);
      if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);
    }

    if (user.pdfs && user.pdfs.length > 0) {
      for (const pdf of user.pdfs) {
        const pdfPath = path.join(__dirname, 'uploads', 'pdfs', pdf.filename);
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      }
    }

    if (user.images && user.images.length > 0) {
      for (const image of user.images) {
        const imagePath = path.join(__dirname, 'uploads', 'images', image.filename);
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      }
    }

    if (user.documents && user.documents.length > 0) {
      for (const doc of user.documents) {
        const docPath = path.join(__dirname, 'uploads', 'documents', doc.filename);
        if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
      }
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: 'Error deleting user' });
  }
});

app.delete('/admin/contacts/:id', requireAdminAuth, async (req, res) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ success: false, message: 'Error deleting contact' });
  }
});

// =====================================
// Rename File Routes
// =====================================

// Rename PDF
app.put('/rename-pdf/:userId/:filename', async (req, res) => {
  try {
    const { userId, filename } = req.params;
    const { newName } = req.body;
    
    if (req.session.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    if (!newName || newName.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'New name is required' });
    }
    
    if (newName.length > 255) {
      return res.status(400).json({ success: false, message: 'Filename too long' });
    }
    
    const sanitizedFilename = path.basename(filename);
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Find the PDF in user's pdfs array
    const pdfIndex = user.pdfs.findIndex(p => p.filename === sanitizedFilename);
    if (pdfIndex === -1) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    // Preserve file extension
    const oldName = user.pdfs[pdfIndex].name;
    const ext = path.extname(oldName);
    const newNameWithExt = newName.endsWith(ext) ? newName : newName + ext;
    
    // Update the name
    user.pdfs[pdfIndex].name = newNameWithExt;
    await user.save();
    
    await logActivity(
      userId,
      'file_rename',
      `Renamed PDF: ${oldName} → ${newNameWithExt}`,
      { 
        filename: sanitizedFilename,
        oldName: oldName,
        newName: newNameWithExt,
        fileType: 'pdf'
      },
      req
    );
    
    res.json({ 
      success: true, 
      message: 'File renamed successfully',
      newName: newNameWithExt
    });
  } catch (error) {
    console.error('Rename PDF error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Rename Image
app.put('/rename-image/:userId/:filename', async (req, res) => {
  try {
    const { userId, filename } = req.params;
    const { newName } = req.body;
    
    if (req.session.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    if (!newName || newName.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'New name is required' });
    }
    
    const sanitizedFilename = path.basename(filename);
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const imageIndex = user.images.findIndex(i => i.filename === sanitizedFilename);
    if (imageIndex === -1) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    const oldName = user.images[imageIndex].name;
    const ext = path.extname(oldName);
    const newNameWithExt = newName.endsWith(ext) ? newName : newName + ext;
    
    user.images[imageIndex].name = newNameWithExt;
    await user.save();
    
    await logActivity(
      userId,
      'file_rename',
      `Renamed Image: ${oldName} → ${newNameWithExt}`,
      { 
        filename: sanitizedFilename,
        oldName: oldName,
        newName: newNameWithExt,
        fileType: 'image'
      },
      req
    );
    
    res.json({ 
      success: true, 
      message: 'File renamed successfully',
      newName: newNameWithExt
    });
  } catch (error) {
    console.error('Rename image error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Rename Document
app.put('/rename-document/:userId/:filename', async (req, res) => {
  try {
    const { userId, filename } = req.params;
    const { newName } = req.body;
    
    if (req.session.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    if (!newName || newName.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'New name is required' });
    }
    
    const sanitizedFilename = path.basename(filename);
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const docIndex = user.documents.findIndex(d => d.filename === sanitizedFilename);
    if (docIndex === -1) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    const oldName = user.documents[docIndex].name;
    const ext = path.extname(oldName);
    const newNameWithExt = newName.endsWith(ext) ? newName : newName + ext;
    
    user.documents[docIndex].name = newNameWithExt;
    await user.save();
    
    await logActivity(
      userId,
      'file_rename',
      `Renamed Document: ${oldName} → ${newNameWithExt}`,
      { 
        filename: sanitizedFilename,
        oldName: oldName,
        newName: newNameWithExt,
        fileType: 'document',
        docType: user.documents[docIndex].type
      },
      req
    );
    
    res.json({ 
      success: true, 
      message: 'File renamed successfully',
      newName: newNameWithExt
    });
  } catch (error) {
    console.error('Rename document error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =====================================
// 16.5 Registration Toggle API Endpoints
// =====================================

app.get('/admin/registration-status', requireAdminAuth, async (req, res) => {
  try {
    const setting = await SystemSettings.findOne({ key: 'registration_enabled' });
    res.json({ 
      enabled: setting ? setting.value : true 
    });
  } catch (error) {
    console.error('Error fetching registration status:', error);
    res.status(500).json({ error: 'Failed to fetch registration status' });
  }
});

app.post('/admin/toggle-registration', requireAdminAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid enabled value' });
    }
    
    const setting = await SystemSettings.findOneAndUpdate(
      { key: 'registration_enabled' },
      { 
        value: enabled, 
        updatedAt: new Date(),
        updatedBy: req.session.adminEmail 
      },
      { upsert: true, new: true }
    );
    
    console.log(`🔒 Admin ${req.session.adminEmail} ${enabled ? 'enabled' : 'disabled'} registrations`);
    
    res.json({ 
      success: true, 
      enabled: enabled,
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
      message: `Registrations ${enabled ? 'enabled' : 'disabled'} successfully` 
    });
  } catch (error) {
    console.error('Error toggling registration:', error);
    res.status(500).json({ error: 'Failed to update registration status' });
  }
});

// =====================================
// Maintenance toggle endpoints
// =====================================
app.get('/admin/maintenance-status', requireAdminAuth, async (req, res) => {
  try {
    const setting = await SystemSettings.findOne({ key: 'maintenance_enabled' });
    res.json({
      enabled: setting ? setting.value : false
    });
  } catch (error) {
    console.error('Error fetching maintenance status:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance status' });
  }
});

app.post('/admin/toggle-maintenance', requireAdminAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid enabled value' });
    }

    const setting = await SystemSettings.findOneAndUpdate(
      { key: 'maintenance_enabled' },
      {
        value: enabled,
        updatedAt: new Date(),
        updatedBy: req.session.adminEmail
      },
      { upsert: true, new: true }
    );

    console.log(`🔧 Admin ${req.session.adminEmail} ${enabled ? 'enabled' : 'disabled'} maintenance mode`);

    res.json({
      success: true,
      enabled: enabled,
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
      bypassUrl: enabled ? '/admin-login-bypass' : null,
      message: enabled 
        ? 'Maintenance mode enabled. Use /admin-login-bypass to access admin panel.' 
        : 'Maintenance mode disabled.'
    });
  } catch (error) {
    console.error('Error toggling maintenance:', error);
    res.status(500).json({ error: 'Failed to update maintenance status' });
  }
});

// =====================================
// Debug endpoint to check maintenance status
// =====================================
app.get('/admin/debug-maintenance', requireAdminAuth, async (req, res) => {
  try {
    const setting = await SystemSettings.findOne({ key: 'maintenance_enabled' });
    res.json({
      maintenance_enabled: setting ? setting.value : false,
      setting_exists: !!setting,
      setting_value: setting,
      env_bypass_key: process.env.ADMIN_BYPASS_KEY ? 'Set' : 'Not set',
      session: {
        isAdmin: req.session.isAdmin || false,
        adminEmail: req.session.adminEmail || null,
        userId: req.session.userId || null
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// Admin bypass login endpoint (FIXED - with session save)
// =====================================
app.post('/admin_login_bypass', async (req, res) => {
  try {
    const { email, password, bypassKey } = req.body;
    
    // Check if maintenance is actually enabled
    const maintenanceSetting = await SystemSettings.findOne({ key: 'maintenance_enabled' });
    const maintenanceEnabled = maintenanceSetting ? maintenanceSetting.value : false;
    
    if (!maintenanceEnabled) {
      return res.json({ 
        success: true, 
        redirect: '/admin_login',
        message: 'Maintenance mode is not active. Use normal admin login.' 
      });
    }
    
    if (!process.env.ADMIN_BYPASS_KEY) {
      console.error('❌ ADMIN_BYPASS_KEY is not set in .env file!');
      return res.status(500).json({ 
        success: false, 
        message: 'Server configuration error' 
      });
    }
    
    if (bypassKey.trim() !== process.env.ADMIN_BYPASS_KEY.trim()) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid bypass key' 
      });
    }
    
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      // Create admin session
      req.session.isAdmin = true;
      req.session.adminEmail = email;
      
      // Save session before redirecting
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ 
            success: false, 
            message: 'Failed to create session' 
          });
        }
        
        console.log(`🔓 Admin ${email} accessed via bypass during maintenance`);
        
        return res.json({ 
          success: true, 
          redirect: '/admin_space',
          message: 'Admin login successful!' 
        });
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid admin credentials' 
      });
    }
  } catch (error) {
    console.error('Admin bypass login error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Public endpoint to check registration status
app.get('/api/registration-status', async (req, res) => {
  try {
    const setting = await SystemSettings.findOne({ key: 'registration_enabled' });
    res.json({ 
      enabled: setting ? setting.value : true 
    });
  } catch (error) {
    console.error('Error fetching registration status:', error);
    res.status(500).json({ error: 'Failed to fetch registration status' });
  }
});

// Get user files data for stats update
app.get('/api/user-files', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      pdfs: user.pdfs || [],
      images: user.images || [],
      documents: user.documents || []
    });
  } catch (error) {
    console.error('Error fetching user files:', error);
    res.status(500).json({ message: 'Error fetching files' });
  }
});

// =====================================
// User Activities API Endpoint
// =====================================
app.get('/api/user-activities', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const limit = parseInt(req.query.limit) || 50;
    const activities = await Activity.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Error fetching activities' });
  }
});

// =====================================
// 17. Delete Account Route
// =====================================

app.delete('/delete-account', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await User.findById(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.profilePicture?.filename) {
      const profilePath = path.join(__dirname, 'uploads', 'profile-pictures', user.profilePicture.filename);
      if (fs.existsSync(profilePath)) {
        try {
          fs.unlinkSync(profilePath);
        } catch (err) {
          console.error('Error deleting profile picture:', err);
        }
      }
    }

    if (user.pdfs && user.pdfs.length > 0) {
      for (const pdf of user.pdfs) {
        const pdfPath = path.join(__dirname, 'uploads', 'pdfs', pdf.filename);
        if (fs.existsSync(pdfPath)) {
          try {
            fs.unlinkSync(pdfPath);
          } catch (err) {
            console.error('Error deleting PDF:', pdf.filename, err);
          }
        }
      }
    }

    if (user.images && user.images.length > 0) {
      for (const image of user.images) {
        const imagePath = path.join(__dirname, 'uploads', 'images', image.filename);
        if (fs.existsSync(imagePath)) {
          try {
            fs.unlinkSync(imagePath);
          } catch (err) {
            console.error('Error deleting image:', image.filename, err);
          }
        }
      }
    }

    if (user.documents && user.documents.length > 0) {
      for (const doc of user.documents) {
        const docPath = path.join(__dirname, 'uploads', 'documents', doc.filename);
        if (fs.existsSync(docPath)) {
          try {
            fs.unlinkSync(docPath);
          } catch (err) {
            console.error('Error deleting document:', doc.filename, err);
          }
        }
      }
    }

    await Activity.deleteMany({ userId: req.session.userId });
    await User.findByIdAndDelete(req.session.userId);

    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
      res.json({ 
        success: true, 
        message: 'Account deleted successfully',
        redirect: '/'
      });
    });
    
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting account. Please try again.' 
    });
  }
});

app.post('/delete-account', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await User.findById(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.profilePicture?.filename) {
      const profilePath = path.join(__dirname, 'uploads', 'profile-pictures', user.profilePicture.filename);
      if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);
    }

    if (user.pdfs && user.pdfs.length > 0) {
      for (const pdf of user.pdfs) {
        const pdfPath = path.join(__dirname, 'uploads', 'pdfs', pdf.filename);
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      }
    }

    if (user.images && user.images.length > 0) {
      for (const image of user.images) {
        const imagePath = path.join(__dirname, 'uploads', 'images', image.filename);
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      }
    }

    if (user.documents && user.documents.length > 0) {
      for (const doc of user.documents) {
        const docPath = path.join(__dirname, 'uploads', 'documents', doc.filename);
        if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
      }
    }

    await Activity.deleteMany({ userId: req.session.userId });
    await User.findByIdAndDelete(req.session.userId);

    req.session.destroy((err) => {
      if (err) console.error('Error destroying session:', err);
      res.json({ 
        success: true, 
        message: 'Account deleted successfully',
        redirect: '/'
      });
    });
    
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting account. Please try again.' 
    });
  }
});

// =====================================
// 18. Authentication & Logout Routes
// =====================================

// Admin login
app.post('/admin_login', adminLimiter, async (req, res) => {
  try {
    const { email, pass } = req.body;
    
    if (!email || !pass) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required.' 
      });
    }
    
    if (email === process.env.ADMIN_EMAIL && pass === process.env.ADMIN_PASSWORD) {
      req.session.isAdmin = true;
      req.session.adminEmail = email;
      
      return res.json({ 
        success: true, 
        redirect: '/admin_space',
        message: 'Admin login successful!' 
      });
    }
    
    await logFailedLogin(email, req, 'admin_credentials');
    
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid admin credentials. Please try again.' 
    });
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error. Please try again later.' 
    });
  }
});

// User registration
app.post('/register', async (req, res) => {
  try {
    const registrationSetting = await SystemSettings.findOne({ key: 'registration_enabled' });
    const registrationsEnabled = registrationSetting ? registrationSetting.value : true;
    
    if (!registrationsEnabled) {
      return res.status(403).json({ 
        success: false, 
        message: 'New registrations are currently disabled by the administrator. Please check back later.' 
      });
    }
    
    const { name, email, profession, pass } = req.body;
    
    if (!name || !email || !profession || !pass) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required.' 
      });
    }
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'An account with this email already exists.' 
      });
    }
    
    const user = new User({ 
      name, 
      email, 
      profession, 
      pass,
      passwordChangedAt: new Date()
    });
    
    await user.save();
    req.session.userId = user._id;
    
    return res.json({ 
      success: true, 
      redirect: '/space',
      message: 'Registration successful!' 
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'An account with this email already exists.' 
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Server error during registration.' 
    });
  }
});

// User login
app.post('/login', async (req, res) => {
  try {
    const { email, pass } = req.body;
    
    if (!email || !pass) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required.' 
      });
    }
    
    const user = await User.findOne({ email });
    
    if (user) {
      if (pass === user.pass) {
        req.session.userId = user._id;
        
        await logActivity(
          user._id, 
          'login', 
          'Logged in successfully',
          { email: user.email },
          req
        );
        
        return res.json({ 
          success: true, 
          redirect: '/space',
          message: 'Login successful!' 
        });
      } else {
        await logFailedLogin(email, req, 'invalid_password');
        
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid password. Please try again.' 
        });
      }
    } else {
      await logFailedLogin(email, req, 'user_not_found');
      
      return res.status(400).json({ 
        success: false, 
        message: 'No account found with this email.' 
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    
    return res.status(500).json({ 
      success: false, 
      message: 'Server error. Please try again later.' 
    });
  }
});

// =====================================
// 19. Logout Routes
// =====================================

app.get('/admin_logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Admin logout error:', err);
    }
    res.redirect('/');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('Logout error:', err);
    res.redirect('/');
  });
});

// =====================================
// 20. User Dashboard ("Space")
// =====================================

app.get('/space', async (req, res) => {
  try {
    if (!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.redirect('/login');

    if (user.profilePicture && user.profilePicture.filename) {
      user.profilePicture.url = `/uploads/profile-pictures/${user.profilePicture.filename}`;
    }

    if (!user.passwordChangedAt) {
      user.passwordChangedAt = user.createdAt || new Date();
    }

    const getInitials = (name) => {
      if (!name) return 'U';
      return name
        .split(' ')
        .map(word => word.charAt(0).toUpperCase())
        .join('')
        .substring(0, 2);
    };

    res.render('space', {
      title: 'User Space',
      user,
      cacheBust: Date.now(),
      getInitials: getInitials
    });
  } catch (error) {
    console.error('Space error:', error);
    res.redirect('/login');
  }
});

// =====================================
// 21. Form Submission Handling
// =====================================

app.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ 
        error: 'All fields are required' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Please enter a valid email address' 
      });
    }

    if (message.length < 10) {
      return res.status(400).json({ 
        error: 'Message must be at least 10 characters long' 
      });
    }

    const contact = new Contact({ 
      name: name.trim(), 
      email: email.trim().toLowerCase(), 
      subject, 
      message: message.trim() 
    });
    
    await contact.save();
    
    console.log(`📧 New contact message from ${email} - Subject: ${subject}`);
    
    res.status(201).json({ 
      message: 'Message sent successfully!' 
    });
  } catch (error) {
    console.error('Contact form error:', error);
    
    res.status(500).json({ 
      error: 'Failed to send message. Please try again.' 
    });
  }
});

app.post('/delete/:id', async (req, res) => {
  try {
    if (!req.session.userId) return res.redirect('/login');
    await User.findByIdAndDelete(req.params.id);
    res.redirect('/');
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).send('Error deleting account');
  }
});

// =====================================
// LAST: 404 and Error Handlers
// =====================================

// 404 handler
app.use((req, res, next) => {
  res.status(404).render('404', {
    title: 'Page Not Found',
    currentUser: req.session?.userId ? { id: req.session.userId } : null
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  
  const statusCode = err.status || 500;
  
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.status(statusCode).json({ 
      error: process.env.NODE_ENV === 'production' 
        ? 'Something went wrong' 
        : err.message 
    });
  }
  
  res.status(statusCode).render('error', {
    title: 'Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong. Please try again.' 
      : err.message,
    error: process.env.NODE_ENV === 'development' ? err : {},
    currentUser: req.session?.userId ? { id: req.session.userId } : null
  });
});

// =====================================
// 22. Start the Server
// =====================================

const serverStartTime = new Date();

app.listen(port, () => {
  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║        Server is active on port ${port}         ║`);
  console.log(`║           http://localhost:${port}              ║`);
  console.log(`║                                              ║`);
  console.log(`║        Server started at: ${serverStartTime.toLocaleTimeString()} `);
  console.log(`╚══════════════════════════════════════════════╝`);
});