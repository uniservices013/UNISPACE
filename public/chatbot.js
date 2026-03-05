// =====================================
// UniSpace AI Chatbot - FIXED VERSION
// =====================================

class UniSpaceChatbot {
    constructor() {
        this.sessionId = null;
        this.isOpen = false;
        this.isTyping = false;
        this.aiEnabled = false;
        this.aiProvider = 'none';
        this.useAI = true; // Default to using AI if available
        
        this.quickActions = [
            { text: "How to upload files?", icon: "fas fa-cloud-upload-alt", emoji: "📤" },
            { text: "Is my data secure?", icon: "fas fa-shield-alt", emoji: "🔒" },
            { text: "How to change password?", icon: "fas fa-key", emoji: "🔑" },
            { text: "What files can I store?", icon: "fas fa-file", emoji: "📁" },
            { text: "How to delete files?", icon: "fas fa-trash", emoji: "🗑️" },
            { text: "Contact support", icon: "fas fa-headset", emoji: "📞" }
        ];
        
        this.init();
    }
    
    async init() {
        console.log('🤖 UniSpace Chatbot initializing...');
        
        try {
            await this.createSession();
            await this.checkAICapabilities();
            
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    this.setupChatbot();
                });
            } else {
                this.setupChatbot();
            }
        } catch (error) {
            console.error('Chatbot initialization failed:', error);
        }
    }
    
    setupChatbot() {
        console.log('🛠️ Setting up chatbot UI...');
        
        // Check if chatbot already exists
        if (document.querySelector('.chatbot-widget')) {
            console.log('Chatbot already exists, reusing...');
            this.bindEvents();
            return;
        }
        
        this.renderChatbot();
        this.bindEvents();
        this.showWelcomeMessage();
        
        // Make it globally available
        window.UniSpaceChatbot = this;
        
        console.log('✅ Chatbot setup complete');
    }
    
    async createSession() {
        try {
            const response = await fetch('/api/chat/session');
            const data = await response.json();
            this.sessionId = data.sessionId;
            this.aiEnabled = data.aiEnabled;
            this.aiProvider = data.aiProvider;
            
            console.log(`📝 Chat session created: ${this.sessionId}`);
            console.log(`🤖 AI Status: ${this.aiEnabled ? 'Enabled (' + this.aiProvider + ')' : 'Disabled'}`);
        } catch (error) {
            console.error('Failed to create session:', error);
        }
    }
    
    async checkAICapabilities() {
        try {
            const response = await fetch('/api/chat/capabilities');
            const data = await response.json();
            this.aiEnabled = data.aiEnabled;
            this.aiProvider = data.provider;
        } catch (error) {
            console.error('Failed to check AI capabilities:', error);
        }
    }
    
    renderChatbot() {
        console.log('🎨 Rendering chatbot UI...');
        
        const chatbotHTML = `
            <div class="chatbot-widget">
                <button class="chatbot-toggle" id="chatbotToggle" aria-label="Open chat">
                    <i class="fas fa-comment-dots"></i>
                    <span class="notification-badge" id="notificationBadge" style="display: none;">1</span>
                </button>
                
                <div class="chatbot-container" id="chatbotContainer" role="dialog" aria-label="Chat with UniSpace Assistant">
                    <div class="chatbot-header">
                        <h3><i class="fas fa-robot"></i> UniSpace Assistant</h3>
                        <button class="chatbot-close" id="chatbotClose" aria-label="Close chat">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div class="chatbot-messages" id="chatbotMessages" role="log" aria-live="polite"></div>
                    
                    <div class="chatbot-input-container">
                        <div class="chatbot-quick-actions" id="quickActions" role="toolbar"></div>
                        <div class="chatbot-input-wrapper">
                            <input 
                                type="text" 
                                class="chatbot-input" 
                                id="chatbotInput" 
                                placeholder="Ask me anything about UniSpace..."
                                maxlength="500"
                                aria-label="Type your message"
                            >
                            <button class="chatbot-send" id="chatbotSend" aria-label="Send message">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', chatbotHTML);
        this.renderQuickActions();
        
        // Add AI toggle if enabled
        if (this.aiEnabled) {
            this.addAIToggle();
        }
    }
    
    renderQuickActions() {
        const quickActionsContainer = document.getElementById('quickActions');
        if (!quickActionsContainer) {
            console.error('Quick actions container not found!');
            return;
        }
        
        console.log('🔄 Rendering quick actions...');
        
        const actionsHTML = this.quickActions.map(action => 
            `<button class="quick-action-btn" data-action="${action.text}" aria-label="${action.text}">
                <span class="action-emoji">${action.emoji}</span>
                <span class="action-text">${action.text}</span>
            </button>`
        ).join('');
        
        quickActionsContainer.innerHTML = actionsHTML;
        
        console.log(`✅ Rendered ${this.quickActions.length} quick actions`);
    }
    
    bindEvents() {
        console.log('🔗 Binding chatbot events...');
        
        const toggleBtn = document.getElementById('chatbotToggle');
        const closeBtn = document.getElementById('chatbotClose');
        const sendBtn = document.getElementById('chatbotSend');
        const input = document.getElementById('chatbotInput');
        const container = document.getElementById('chatbotContainer');
        
        if (!toggleBtn || !closeBtn || !sendBtn || !input || !container) {
            console.error('❌ Chatbot elements not found!');
            return;
        }
        
        // Toggle chatbot
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleChatbot();
        });
        
        // Close chatbot
        closeBtn.addEventListener('click', () => this.closeChatbot());
        
        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isOpen && !container.contains(e.target) && e.target !== toggleBtn) {
                this.closeChatbot();
            }
        });
        
        // Send message
        sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Enter to send
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // FIXED: Quick actions with proper event delegation
        document.body.addEventListener('click', (e) => {
            if (e.target.closest('.quick-action-btn')) {
                const btn = e.target.closest('.quick-action-btn');
                const action = btn.getAttribute('data-action');
                
                console.log('🚀 Quick action clicked:', action);
                
                if (input) {
                    input.value = action;
                    
                    // Small delay to ensure UI updates
                    setTimeout(() => {
                        this.sendMessage();
                    }, 100);
                }
            }
        });
        
        console.log('✅ Event binding complete');
    }
    
    toggleChatbot() {
        const container = document.getElementById('chatbotContainer');
        const toggleBtn = document.getElementById('chatbotToggle');
        
        this.isOpen = !this.isOpen;
        
        if (this.isOpen) {
            container.classList.add('active');
            toggleBtn.style.transform = 'rotate(360deg) scale(1.1)';
            toggleBtn.style.backgroundColor = '#4f46e5';
            document.getElementById('notificationBadge').style.display = 'none';
            
            // Focus input after animation
            setTimeout(() => {
                const input = document.getElementById('chatbotInput');
                if (input) input.focus();
                this.scrollToBottom();
            }, 300);
        } else {
            container.classList.remove('active');
            toggleBtn.style.transform = '';
            toggleBtn.style.backgroundColor = '';
        }
    }
    
    closeChatbot() {
        this.isOpen = false;
        const container = document.getElementById('chatbotContainer');
        const toggleBtn = document.getElementById('chatbotToggle');
        
        if (container) container.classList.remove('active');
        if (toggleBtn) {
            toggleBtn.style.transform = '';
            toggleBtn.style.backgroundColor = '';
        }
    }
    
    async sendMessage() {
        const input = document.getElementById('chatbotInput');
        const message = input.value.trim();
        const sendBtn = document.getElementById('chatbotSend');
        
        if (!message || this.isTyping || message.length > 500) {
            if (message.length > 500) {
                this.showError('Message too long (max 500 characters)');
            }
            return;
        }
        
        // Clear input
        input.value = '';
        sendBtn.disabled = true;
        
        // Add user message
        this.addMessage(message, 'user');
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            console.log('📤 Sending message to server:', message);
            
            const response = await fetch('/api/chat/message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.sessionId,
                    useAI: this.useAI && this.aiEnabled
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            this.removeTypingIndicator();
            
            console.log('📥 Received response from server');
            
            // Add bot response
            this.addMessage(data.response, 'assistant');
            
        } catch (error) {
            console.error('Failed to send message:', error);
            this.removeTypingIndicator();
            
            // Show error message
            this.addMessage(
                "I'm having trouble connecting right now. Please try again.", 
                'assistant'
            );
            
            this.showError('Connection failed. Please try again.');
        }
        
        sendBtn.disabled = false;
        if (input) input.focus();
    }
    
    addMessage(content, role, aiBadge = '') {
        const messagesContainer = document.getElementById('chatbotMessages');
        if (!messagesContainer) return;
        
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const messageHTML = `
            <div class="chat-message message-${role}" role="${role === 'user' ? 'status' : 'article'}">
                <div class="message-content">
                    ${this.escapeHTML(content)}
                    ${aiBadge}
                </div>
                <div class="message-time">
                    <i class="fas fa-clock"></i>
                    <span>${time}</span>
                </div>
            </div>
        `;
        
        messagesContainer.insertAdjacentHTML('beforeend', messageHTML);
        this.scrollToBottom();
        
        // Show notification badge if chatbot is closed
        if (!this.isOpen && role === 'assistant') {
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.style.display = 'flex';
                badge.textContent = '!';
            }
        }
    }
    
    showWelcomeMessage() {
        const messagesContainer = document.getElementById('chatbotMessages');
        if (!messagesContainer) return;
        
        const aiStatusHTML = this.aiEnabled 
            ? `<div class="ai-welcome-badge">
                  <i class="fas fa-bolt"></i>
                  <span>Powered by ${this.aiProvider.toUpperCase()} AI</span>
               </div>`
            : '';
        
        const welcomeHTML = `
            <div class="chatbot-welcome">
                <h4><i class="fas fa-robot"></i> Hi! I'm your UniSpace Assistant</h4>
                <p>I can help you with:</p>
                
                <div class="welcome-features">
                    <div class="feature-item">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <span>File Uploads</span>
                    </div>
                    <div class="feature-item">
                        <i class="fas fa-lock"></i>
                        <span>Security & Privacy</span>
                    </div>
                    <div class="feature-item">
                        <i class="fas fa-cog"></i>
                        <span>Account Settings</span>
                    </div>
                </div>
                
                ${aiStatusHTML}
                
                <p style="font-size: 0.8rem; margin-top: 1rem; color: #64748b;">
                    <i class="fas fa-lightbulb"></i> Try clicking a question below!
                </p>
            </div>
        `;
        
        messagesContainer.innerHTML = welcomeHTML;
    }
    
    showTypingIndicator() {
        this.isTyping = true;
        const messagesContainer = document.getElementById('chatbotMessages');
        if (!messagesContainer) return;
        
        const typingHTML = `
            <div class="chatbot-typing" id="typingIndicator" aria-label="Assistant is typing">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
                <span>Assistant is typing...</span>
            </div>
        `;
        
        messagesContainer.insertAdjacentHTML('beforeend', typingHTML);
        this.scrollToBottom();
    }
    
    removeTypingIndicator() {
        this.isTyping = false;
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    scrollToBottom() {
        const messagesContainer = document.getElementById('chatbotMessages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    
    escapeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/\n/g, '<br>');
    }
    
    showError(message) {
        console.error('❌ Error:', message);
        // Create a simple error notification
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 1rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
            z-index: 9999;
        `;
        errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 3000);
    }
    
    addAIToggle() {
        const quickActionsContainer = document.getElementById('quickActions');
        if (!quickActionsContainer) return;
        
        const aiToggleHTML = `
            <div class="ai-toggle-container" style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; padding: 0.5rem; background: rgba(99, 102, 241, 0.05); border-radius: 10px;">
                <label class="ai-toggle-label" style="font-size: 0.8rem; color: #64748b; display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-brain"></i>
                    <span>AI Mode</span>
                </label>
                <label class="toggle-switch" style="position: relative; display: inline-block; width: 40px; height: 20px;">
                    <input type="checkbox" id="aiToggle" ${this.useAI ? 'checked' : ''}>
                    <span class="toggle-slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .4s; border-radius: 20px;"></span>
                </label>
                <span id="aiStatus" style="font-size: 0.75rem; font-weight: 500; color: ${this.useAI ? '#10b981' : '#64748b'}">
                    ${this.useAI ? 'ON' : 'OFF'}
                </span>
            </div>
        `;
        
        quickActionsContainer.insertAdjacentHTML('afterbegin', aiToggleHTML);
        
        // Add toggle event
        const aiToggle = document.getElementById('aiToggle');
        if (aiToggle) {
            aiToggle.addEventListener('change', (e) => {
                this.useAI = e.target.checked;
                const aiStatus = document.getElementById('aiStatus');
                if (aiStatus) {
                    aiStatus.textContent = this.useAI ? 'ON' : 'OFF';
                    aiStatus.style.color = this.useAI ? '#10b981' : '#64748b';
                }
                
                // Show notification about mode change
                this.addSystemMessage(`Switched to ${this.useAI ? 'AI' : 'Rule-based'} mode`);
            });
        }
        
        // Add toggle switch styles
        this.addToggleStyles();
    }
    
    addToggleStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            
            .toggle-slider:before {
                position: absolute;
                content: "";
                height: 16px;
                width: 16px;
                left: 2px;
                bottom: 2px;
                background-color: white;
                transition: .4s;
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            }
            
            input:checked + .toggle-slider {
                background-color: #10b981;
            }
            
            input:checked + .toggle-slider:before {
                transform: translateX(20px);
            }
            
            .toggle-switch:hover .toggle-slider {
                box-shadow: 0 0 1px #10b981;
            }
        `;
        document.head.appendChild(style);
    }
    
    addSystemMessage(message) {
        const messagesContainer = document.getElementById('chatbotMessages');
        if (!messagesContainer) return;
        
        const systemHTML = `
            <div class="system-message" style="text-align: center; margin: 0.5rem 0;">
                <span style="font-size: 0.75rem; color: #64748b; background: rgba(99, 102, 241, 0.08); padding: 0.25rem 0.75rem; border-radius: 12px; display: inline-block;">
                    <i class="fas fa-info-circle"></i> ${message}
                </span>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', systemHTML);
        this.scrollToBottom();
    }
    
    adjustInputHeight() {
        const input = document.getElementById('chatbotInput');
        if (input) {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        }
    }
}

// Initialize chatbot only once
if (!window.chatbotInitialized) {
    window.chatbotInitialized = true;
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('🚀 Starting UniSpace Chatbot...');
            new UniSpaceChatbot();
        });
    } else {
        console.log('🚀 Starting UniSpace Chatbot (DOM already ready)...');
        new UniSpaceChatbot();
    }
}

// Emergency event fix for quick actions (runs after 2 seconds)
setTimeout(() => {
    const quickActionBtns = document.querySelectorAll('.quick-action-btn');
    if (quickActionBtns.length > 0) {
        console.log('🛠️ Applying emergency event fix...');
        
        quickActionBtns.forEach(btn => {
            // Clone to remove old listeners
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            // Add new listener
            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                
                const action = this.getAttribute('data-action') || this.textContent.trim();
                console.log('🚀 Emergency quick action clicked:', action);
                
                const input = document.getElementById('chatbotInput');
                if (input) {
                    input.value = action;
                    
                    // Trigger send after a small delay
                    setTimeout(() => {
                        const sendBtn = document.getElementById('chatbotSend');
                        if (sendBtn) {
                            sendBtn.click();
                        }
                    }, 100);
                }
            });
        });
        
        console.log('✅ Emergency fix applied to', quickActionBtns.length, 'buttons');
    }
}, 2000);