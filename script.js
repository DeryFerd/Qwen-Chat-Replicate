document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const welcomeScreen = document.getElementById('welcome-screen');
    const messagesContainer = document.getElementById('messages-container');
    const chatArea = document.getElementById('chat-area');

    const OLLAMA_API_KEY = window.OLLAMA_API_KEY || '';

    function getSelectedModel() {
        const active = document.querySelector('.model-option.active');
        return active ? active.getAttribute('data-model') : 'qwen3.5:397b-cloud';
    }

    // Sidebar Toggle
    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const appContainer = document.querySelector('.app-container');

    function toggleSidebar() {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('open');
        } else {
            appContainer.classList.toggle('sidebar-collapsed');
        }
    }

    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', toggleSidebar);
    }

    // Model Selector Dropdown
    const modelSelector = document.getElementById('model-selector');
    const modelOptions = document.querySelectorAll('.model-option');
    const modelNameDisplay = document.querySelector('.model-selector-btn .model-name');

    if (modelSelector) {
        modelSelector.addEventListener('click', (e) => {
            // Close if clicking an option (handled below), otherwise toggle dropdown
            if (!e.target.closest('.model-option')) {
                modelSelector.classList.toggle('open');
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!modelSelector.contains(e.target)) {
                modelSelector.classList.remove('open');
            }
        });
    }

    modelOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Remove active class from all
            modelOptions.forEach(opt => opt.classList.remove('active'));
            // Add active class to clicked
            option.classList.add('active');

            // Update display text (trim to just text node without icon)
            const text = option.textContent.trim();
            modelNameDisplay.textContent = text;

            // Close dropdown
            modelSelector.classList.remove('open');

            // TODO for backend: option.getAttribute('data-model') contains the selected model ID
        });
    });

    // --- state management ---
    let chats = JSON.parse(localStorage.getItem('qwen_chats') || '[]');
    let currentChatId = null;
    let currentMessages = [];
    let botResponseTimeout = null;

    // Elements
    const sidebarContent = document.querySelector('.sidebar-content');

    // Define global menu state
    let activeDropdownId = null;
    let chatToDeleteId = null;
    let globalDropdown = document.getElementById('global-chat-options-dropdown');

    if (!globalDropdown) {
        globalDropdown = document.createElement('div');
        globalDropdown.id = 'global-chat-options-dropdown';
        globalDropdown.className = 'chat-options-dropdown global-overlay';
        globalDropdown.innerHTML = `
            <button class="chat-option-item rename-option" id="global-rename-btn">
                <i class="ph ph-pencil-simple"></i> Rename
            </button>
            <button class="chat-option-item pin-option" id="global-pin-btn">
                <i class="ph ph-push-pin"></i> Pin
            </button>
            <div class="chat-option-item download-group">
                <div class="download-label">
                    <i class="ph ph-download-simple"></i> Download <i class="ph ph-caret-right"></i>
                </div>
                <div class="download-actions">
                    <button class="download-txt-option" id="global-download-txt-btn"><i class="ph ph-file-text"></i>.txt</button>
                    <button class="download-json-option" id="global-download-json-btn"><i class="ph ph-file-code"></i>.json</button>
                </div>
            </div>
            <button class="chat-option-item delete-option" id="global-delete-btn">
                <i class="ph ph-trash"></i> Delete
            </button>
        `;
        document.body.appendChild(globalDropdown);

        // Bind global actions
        document.getElementById('global-rename-btn').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!activeDropdownId) return;
            const newName = prompt("Enter new chat name:");
            if (newName && newName.trim()) {
                renameChat(activeDropdownId, newName.trim());
            }
            hideGlobalDropdown();
        });

        document.getElementById('global-pin-btn').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!activeDropdownId) return;
            alert('Pin chat logic can be wired up here!');
            hideGlobalDropdown();
        });

        document.getElementById('global-download-txt-btn').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!activeDropdownId) return;
            downloadChat(activeDropdownId, 'txt');
            hideGlobalDropdown();
        });

        document.getElementById('global-download-json-btn').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!activeDropdownId) return;
            downloadChat(activeDropdownId, 'json');
            hideGlobalDropdown();
        });

        document.getElementById('global-delete-btn').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!activeDropdownId) return;
            chatToDeleteId = activeDropdownId;
            document.getElementById('delete-modal').classList.add('show');
            hideGlobalDropdown();
        });

        // Delete Modal Event Listeners
        document.getElementById('cancel-delete-btn').addEventListener('click', () => {
            chatToDeleteId = null;
            document.getElementById('delete-modal').classList.remove('show');
        });

        document.getElementById('confirm-delete-btn').addEventListener('click', () => {
            if (chatToDeleteId) {
                deleteChat(chatToDeleteId);
                chatToDeleteId = null;
            }
            document.getElementById('delete-modal').classList.remove('show');
        });

        // Hide on outside click for dropdown
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.chat-options-btn') && !e.target.closest('#global-chat-options-dropdown')) {
                hideGlobalDropdown();
            }
        });
    }

    function hideGlobalDropdown() {
        globalDropdown.classList.remove('show');
        document.querySelectorAll('.history-item.menu-open').forEach(el => el.classList.remove('menu-open'));
        activeDropdownId = null;
    }

    function saveChats() {
        localStorage.setItem('qwen_chats', JSON.stringify(chats));
    }

    function renderSidebar() {
        // Group chats
        const now = new Date();
        const today = [];
        const yesterday = [];
        const previous = [];

        chats.forEach(chat => {
            const chatDate = new Date(chat.updatedAt);
            const diffTime = Math.abs(now - chatDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 1) {
                if (now.getDate() === chatDate.getDate()) {
                    today.push(chat);
                } else {
                    yesterday.push(chat);
                }
            } else if (diffDays <= 7) {
                previous.push(chat);
            } else {
                previous.push(chat); // just dump older ones here for now
            }
        });

        sidebarContent.innerHTML = '';

        function createSection(title, list) {
            if (list.length === 0) return '';
            let html = `<div class="history-section"><h3 class="section-title">${title}</h3><ul class="history-list">`;
            list.forEach(chat => {
                html += `
                    <li>
                        <a href="#" class="history-item" data-id="${chat.id}">
                            <i class="ph ph-chat-teardrop-text"></i>
                            <span class="history-link-text">${chat.title}</span>
                            <button class="chat-options-btn" data-id="${chat.id}" title="Options">
                                <i class="ph ph-dots-three"></i>
                            </button>
                        </a>
                    </li>
                `;
            });
            html += `</ul></div>`;
            return html;
        }

        sidebarContent.innerHTML += createSection('Today', today);
        sidebarContent.innerHTML += createSection('Yesterday', yesterday);
        sidebarContent.innerHTML += createSection('Previous 7 Days', previous);

        // Bind clicks for loading chats
        document.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Ignore click if it was on the options button or inside the dropdown
                if (e.target.closest('.chat-options-btn') || e.target.closest('.chat-options-dropdown')) return;

                e.preventDefault();
                loadChat(item.getAttribute('data-id'));
            });
        });

        // Toggle Option Menus (Global Overlay logic)
        document.querySelectorAll('.chat-options-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const id = btn.getAttribute('data-id');
                const historyItem = btn.closest('.history-item');

                if (activeDropdownId === id && globalDropdown.classList.contains('show')) {
                    hideGlobalDropdown();
                } else {
                    hideGlobalDropdown();
                    activeDropdownId = id;
                    historyItem.classList.add('menu-open');

                    const rect = btn.getBoundingClientRect();
                    globalDropdown.style.top = `${rect.bottom + 4}px`;
                    globalDropdown.style.left = `${rect.left}px`;
                    globalDropdown.classList.add('show');
                }
            });
        });
    }

    function renameChat(id, newTitle) {
        const index = chats.findIndex(c => c.id === id);
        if (index !== -1) {
            chats[index].title = newTitle;
            saveChats();
            renderSidebar();
        }
    }

    function downloadChat(id, format) {
        const chat = chats.find(c => c.id === id);
        if (!chat) return;

        let content = '';
        let type = '';
        let extension = '';

        if (format === 'json') {
            content = JSON.stringify(chat, null, 2);
            type = 'application/json';
            extension = 'json';
        } else {
            // txt format
            content = `Chat: ${chat.title}\nDate: ${chat.updatedAt}\n\n`;
            chat.messages.forEach(msg => {
                content += `[${msg.role.toUpperCase()}]:\n${msg.content}\n\n`;
            });
            type = 'text/plain';
            extension = 'txt';
        }

        const blob = new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qwen-chat-${chat.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function deleteChat(id) {
        // Remove from array
        chats = chats.filter(c => c.id !== id);
        saveChats();

        // If we deleted the current chat, clear the view
        if (currentChatId === id) {
            currentChatId = null;
            currentMessages = [];
            messagesContainer.innerHTML = '';
            messagesContainer.style.display = 'none';
            welcomeScreen.style.display = '';
        }

        // Re-render
        renderSidebar();
    }

    function loadChat(id) {
        const chat = chats.find(c => c.id === id);
        if (!chat) return;

        currentChatId = chat.id;
        currentMessages = [...chat.messages];

        // Render
        messagesContainer.innerHTML = '';
        welcomeScreen.style.display = 'none';
        messagesContainer.style.display = 'flex';

        currentMessages.forEach(msg => appendMessageDOM(msg.role, msg.content));

        // Scroll to bottom
        setTimeout(() => {
            chatArea.scrollTo({ top: chatArea.scrollHeight });
        }, 50);

        if (window.innerWidth <= 768) {
            toggleSidebar();
        }
    }

    function saveCurrentChat() {
        if (currentMessages.length === 0) return;

        if (!currentChatId) {
            // Create new
            currentChatId = Date.now().toString();
            const newChat = {
                id: currentChatId,
                title: currentMessages[0].content.length > 40 ? currentMessages[0].content.substring(0, 40) + "..." : currentMessages[0].content,
                messages: currentMessages,
                updatedAt: new Date().toISOString()
            };
            chats.unshift(newChat); // add to top
        } else {
            // Update existing
            const index = chats.findIndex(c => c.id === currentChatId);
            if (index !== -1) {
                chats[index].messages = currentMessages;
                chats[index].updatedAt = new Date().toISOString();

                // Move to top
                const chat = chats.splice(index, 1)[0];
                chats.unshift(chat);
            }
        }
        saveChats();
        renderSidebar();
    }

    // Initialize sidebar
    renderSidebar();

    // New Chat functionality
    const newChatBtn = document.querySelector('.new-chat-btn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            // Save current state if needed
            saveCurrentChat();

            // Reset state
            currentChatId = null;
            currentMessages = [];

            // Clear UI
            messagesContainer.innerHTML = '';
            messagesContainer.style.display = 'none';
            // Need to reset display to flex or empty to use CSS default
            welcomeScreen.style.display = '';
            // Clear input
            chatInput.value = '';
            chatInput.style.height = 'auto';
            sendBtn.setAttribute('disabled', 'true');

            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
    }

    // Auto-resize textarea
    chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';

        // Enable/disable send button
        if (this.value.trim().length > 0) {
            sendBtn.removeAttribute('disabled');
        } else {
            sendBtn.setAttribute('disabled', 'true');
        }
    });
    // Handle sending message
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        if (welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
            messagesContainer.style.display = 'flex';
        }

        currentMessages.push({ role: 'user', content: text });
        appendMessageDOM('user', text);
        saveCurrentChat();

        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.setAttribute('disabled', 'true');

        const targetChatId = currentChatId;

        // Loading bubble
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message assistant';
        loadingDiv.innerHTML = `
            <div class="message-avatar"><img src="./logo.png" alt="Qwen"></div>
            <div class="message-content"><div class="message-bubble">...</div></div>
        `;
        messagesContainer.appendChild(loadingDiv);
        chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });

        try {
            const response = await fetch('https://ollama.run/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({
                    model: getSelectedModel(),
                    messages: currentMessages,
                    stream: true
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullReply = '';

            loadingDiv.remove();
            const streamBubble = appendMessageDOM('assistant', '');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const lines = decoder.decode(value, { stream: true }).split('\n').filter(l => l.trim());
                for (const line of lines) {
                    try {
                        const token = JSON.parse(line)?.message?.content || '';
                        fullReply += token;
                        streamBubble.querySelector('.message-bubble').innerHTML =
                            fullReply.replace(/\n/g, '<br>');
                        chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
                    } catch {}
                }
            }

            currentMessages.push({ role: 'assistant', content: fullReply });
            saveCurrentChat();

        } catch (err) {
            loadingDiv.remove();
            let errorMsg = err.message;
            if (!OLLAMA_API_KEY || OLLAMA_API_KEY === '' || OLLAMA_API_KEY === 'YOUR_API_KEY_HERE') {
                errorMsg = 'API key belum disetting. Edit config.js';
            }
            appendMessageDOM('assistant', `⚠️ Error: ${errorMsg}`);
        } finally {
            sendBtn.removeAttribute('disabled');
        }
    }

    sendBtn.addEventListener('click', sendMessage);

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Suggestion Cards Click
    const suggestionCards = document.querySelectorAll('.suggestion-card');
    suggestionCards.forEach(card => {
        card.addEventListener('click', () => {
            const title = card.querySelector('.suggestion-title').textContent;
            const desc = card.querySelector('.suggestion-desc').textContent;
            chatInput.value = `${title} ${desc}`;
            chatInput.dispatchEvent(new Event('input')); // trigger resize and button state
            chatInput.focus();
        });
    });

    function appendMessageDOM(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        let avatarHtml = '';
        if (role === 'user') {
            avatarHtml = `<div class="message-avatar">U</div>`;
        } else {
            avatarHtml = `
                <div class="message-avatar">
                    <img src="./logo.png" alt="Qwen" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\\'http://www.w3.org/2000/svg\\\' width=\\\'32\\\' height=\\\'32\\\' fill=\\\'none\\\' viewBox=\\\'0 0 32 32\\\'><path fill=\\\'%236366F1\\\' d=\\\'M16 2a14 14 0 1 0 0 28 14 14 0 0 0 0-28zm0 25.2A11.2 11.2 0 1 1 27.2 16 11.2 11.2 0 0 1 16 27.2z\\\'/></svg>'">
                </div>
            `;
        }

        const formattedContent = content.replace(/\n/g, '<br>');

        messageDiv.innerHTML = `
            ${avatarHtml}
            <div class="message-content">
                <div class="message-bubble">${formattedContent}</div>
            </div>
        `;

        messagesContainer.appendChild(messageDiv);

        // Scroll to bottom
        chatArea.scrollTo({
            top: chatArea.scrollHeight,
            behavior: 'smooth'
        });
    }
});
