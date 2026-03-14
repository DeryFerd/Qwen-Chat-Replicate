if (window.marked) {
    marked.setOptions({
        breaks: true,
        gfm: true
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const welcomeScreen = document.getElementById('welcome-screen');
    const messagesContainer = document.getElementById('messages-container');
    const chatArea = document.getElementById('chat-area');

    const CHAT_API_URL = '/api/chat';

    function getSelectedModel() {
        const active = document.querySelector('.model-option.active');
        return active ? active.getAttribute('data-model') : 'qwen3.5:397b-cloud';
    }

    function getModelMetaFromOption(option) {
        return {
            label: option?.getAttribute('data-label') || 'Qwen3.5 397B',
            logoSrc: option?.getAttribute('data-logo') || './assets/models/qwen.png',
            logoAlt: option?.getAttribute('data-alt') || 'Qwen'
        };
    }

    function getActiveModelMeta() {
        return getModelMetaFromOption(document.querySelector('.model-option.active'));
    }

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value ?? '';
        return div.innerHTML;
    }

    function formatPlainText(content) {
        return escapeHtml(content || '').replace(/\n/g, '<br>');
    }

    function renderAssistantMarkdown(content) {
        const raw = window.marked ? marked.parse(content || '') : formatPlainText(content || '');
        return window.DOMPurify ? DOMPurify.sanitize(raw) : raw;
    }

    function ensureLinkTargets(container) {
        container.querySelectorAll('a').forEach(link => {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        });
    }

    function ensureCopyButtons(container) {
        container.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.code-copy-btn')) return;

            const code = pre.querySelector('code');
            if (!code) return;

            pre.classList.add('code-block');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'code-copy-btn';
            button.textContent = 'Copy';
            button.addEventListener('click', async (e) => {
                e.preventDefault();
                const text = code.innerText || code.textContent || '';

                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(text);
                    } else {
                        const textarea = document.createElement('textarea');
                        textarea.value = text;
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.focus();
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                    }

                    button.textContent = 'Copied';
                    setTimeout(() => {
                        button.textContent = 'Copy';
                    }, 1200);
                } catch {
                    button.textContent = 'Failed';
                    setTimeout(() => {
                        button.textContent = 'Copy';
                    }, 1200);
                }
            });

            pre.appendChild(button);
        });
    }

    function highlightCodeBlocks(container) {
        if (!window.hljs) return;
        if (typeof hljs.highlightAll === 'function') {
            hljs.highlightAll();
            return;
        }

        container.querySelectorAll('pre code').forEach(block => {
            try {
                hljs.highlightElement(block);
            } catch {
                // Ignore highlight errors.
            }
        });
    }

    function enhanceMarkdown(container) {
        ensureLinkTargets(container);
        highlightCodeBlocks(container);
        ensureCopyButtons(container);
    }

    function renderMessageBubble(messageBubble, role, content) {
        if (!messageBubble) return;

        if (role === 'assistant') {
            messageBubble.innerHTML = renderAssistantMarkdown(content);
            enhanceMarkdown(messageBubble);
        } else {
            messageBubble.innerHTML = formatPlainText(content);
        }
    }

    function truncateText(value, maxLength) {
        const text = value || '';
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength - 1) + '…';
    }

    function extractDomain(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch {
            return url || '';
        }
    }

    function parseToolResults(toolMessage) {
        if (!toolMessage?.content) return [];
        try {
            const parsed = JSON.parse(toolMessage.content);
            if (!Array.isArray(parsed.results)) return [];
            return parsed.results;
        } catch {
            return [];
        }
    }

    function collectWebSearchResultsBefore(messages, assistantIndex) {
        const results = [];
        if (!Array.isArray(messages)) return results;

        for (let i = assistantIndex - 1; i >= 0; i -= 1) {
            const message = messages[i];
            if (message?.role === 'tool' && message?.tool_name === 'web_search') {
                results.push(...parseToolResults(message));
                continue;
            }
            if (results.length > 0) break;
        }

        return results;
    }

    function renderSourcesForAssistant(messageDiv, assistantIndex) {
        if (!messageDiv) return;
        const messageContent = messageDiv.querySelector('.message-content');
        if (!messageContent) return;

        const existing = messageContent.querySelector('.sources-row');
        if (existing) existing.remove();

        const results = collectWebSearchResultsBefore(currentMessages, assistantIndex);
        if (!results.length) return;

        const row = document.createElement('div');
        row.className = 'sources-row';

        results.forEach(result => {
            const title = truncateText(result?.title || 'Untitled source', 55);
            const url = result?.url || '';
            const domain = extractDomain(url);

            const card = document.createElement('a');
            card.className = 'source-card';
            card.href = url || '#';
            card.target = '_blank';
            card.rel = 'noopener noreferrer';

            const favicon = document.createElement('img');
            favicon.className = 'source-favicon';
            favicon.alt = '';
            favicon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;

            const titleEl = document.createElement('div');
            titleEl.className = 'source-title';
            titleEl.textContent = title;

            const domainEl = document.createElement('div');
            domainEl.className = 'source-domain';
            domainEl.textContent = domain;

            card.appendChild(favicon);
            card.appendChild(titleEl);
            card.appendChild(domainEl);
            row.appendChild(card);
        });

        messageContent.appendChild(row);
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
    const modelLogoDisplay = document.getElementById('selected-model-logo');

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
    function syncSelectedModelDisplay(option) {
        const modelMeta = getModelMetaFromOption(option);
        modelNameDisplay.textContent = modelMeta.label;

        if (modelLogoDisplay) {
            modelLogoDisplay.src = modelMeta.logoSrc;
            modelLogoDisplay.alt = modelMeta.logoAlt;
        }
    }

    syncSelectedModelDisplay(document.querySelector('.model-option.active'));

    modelOptions.forEach(option => {
        option.addEventListener('click', () => {
            // Remove active class from all
            modelOptions.forEach(opt => opt.classList.remove('active'));
            // Add active class to clicked
            option.classList.add('active');
            syncSelectedModelDisplay(option);

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
    let activeAbortController = null;
    const thinkingAnimationState = new WeakMap();

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
                const titleClass = chat.titlePending ? 'history-link-text title-pending' : 'history-link-text';
                html += `
                    <li>
                        <a href="#" class="history-item" data-id="${chat.id}">
                            <i class="ph ph-chat-teardrop-text"></i>
                            <span class="${titleClass}">${chat.title}</span>
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

        currentMessages.forEach((msg, index) => {
            if (msg.role === 'tool') return;
            appendMessageDOM(msg.role, msg.content, { ...msg, messageIndex: index });
        });

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
                title: '...',
                titlePending: true,
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

    function normalizeChatTitle(value) {
        return (value || '')
            .replace(/\s+/g, ' ')
            .replace(/[.!?]+$/g, '')
            .trim();
    }

    async function generateTitleIfNeeded() {
        if (!currentChatId) return;
        const convoMessages = currentMessages.filter(msg => msg.role === 'user' || msg.role === 'assistant');
        if (convoMessages.length !== 2) return;

        const index = chats.findIndex(c => c.id === currentChatId);
        if (index === -1) return;
        if (!chats[index].titlePending) return;

        const systemPrompt = 'Generate a short title (max 6 words) for this conversation. Reply with only the title, no quotes, no punctuation at the end.';

        try {
            const response = await fetch(CHAT_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: getSelectedModel(),
                    stream: false,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        convoMessages[0],
                        convoMessages[1]
                    ]
                })
            });

            if (!response.ok) {
                return;
            }

            const payload = await response.json();
            const rawTitle = payload?.message?.content || payload?.response || '';
            const title = normalizeChatTitle(rawTitle);

            if (!title) return;

            chats[index].title = title;
            chats[index].titlePending = false;
            chats[index].updatedAt = new Date().toISOString();
            saveChats();
            renderSidebar();
        } catch {
            // Leave the placeholder title if generation fails.
        }
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
        if (activeAbortController) {
            return;
        }

        if (this.value.trim().length > 0) {
            sendBtn.removeAttribute('disabled');
        } else {
            sendBtn.setAttribute('disabled', 'true');
        }
    });

    function setSendButtonMode(mode) {
        if (mode === 'stop') {
            sendBtn.classList.add('is-stop');
            sendBtn.innerHTML = '<i class="ph ph-stop-circle"></i>';
            sendBtn.removeAttribute('disabled');
        } else {
            sendBtn.classList.remove('is-stop');
            sendBtn.innerHTML = '<i class="ph ph-paper-plane-right"></i>';
            if (chatInput.value.trim().length > 0) {
                sendBtn.removeAttribute('disabled');
            } else {
                sendBtn.setAttribute('disabled', 'true');
            }
        }
    }

    // Handle sending message
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;
        if (activeAbortController) return;

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

        const selectedModelMeta = getActiveModelMeta();
        let fullReply = '';
        let fullThinking = '';

        const assistantMessage = appendMessageDOM('assistant', '', {
            modelMeta: selectedModelMeta,
            pendingThinking: true
        });
        const controller = new AbortController();
        activeAbortController = controller;
        setSendButtonMode('stop');
        let didFinalize = false;
        const pendingToolMessages = [];

        const finalizeAssistantMessage = ({ aborted } = {}) => {
            if (didFinalize) return;
            didFinalize = true;

            updateAssistantMessageState(assistantMessage, {
                content: fullReply,
                thinking: fullThinking,
                pendingThinking: false
            });

            if (pendingToolMessages.length) {
                currentMessages.push(...pendingToolMessages);
            }

            currentMessages.push({
                role: 'assistant',
                content: fullReply,
                thinking: fullThinking,
                modelMeta: selectedModelMeta
            });
            saveCurrentChat();
            renderSourcesForAssistant(assistantMessage, currentMessages.length - 1);

            if (!aborted) {
                generateTitleIfNeeded();
            }
        };

        try {
            const response = await fetch(CHAT_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: getSelectedModel(),
                    messages: currentMessages.map(({ role, content }) => ({ role, content })),
                    stream: true
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try {
                    const errorPayload = await response.json();
                    errorMsg = errorPayload.error || errorMsg;
                } catch {
                    const fallbackText = await response.text();
                    if (fallbackText) errorMsg = fallbackText;
                }
                throw new Error(errorMsg);
            }

            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                const payload = await response.json();
                fullReply = payload?.message?.content || payload?.response || '';
                fullThinking = payload?.message?.thinking || payload?.thinking || '';

                finalizeAssistantMessage();
                return;
            }

            if (!response.body) {
                throw new Error('Response stream tidak tersedia dari server proxy.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let pending = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                pending += decoder.decode(value, { stream: true });
                const lines = pending.split('\n');
                pending = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const parsed = JSON.parse(line);
                        const thinkingToken = parsed?.message?.thinking || '';
                        const contentToken = parsed?.message?.content || '';
                        const toolName = parsed?.message?.tool_name || parsed?.message?.name;
                        const role = parsed?.message?.role;
                        const isToolMessage = role === 'tool' || Boolean(toolName);

                        if (thinkingToken && !isToolMessage) fullThinking += thinkingToken;
                        if (contentToken && !isToolMessage) fullReply += contentToken;
                        if (toolName) {
                            pendingToolMessages.push({
                                role: 'tool',
                                tool_name: toolName,
                                content: parsed?.message?.content || ''
                            });
                        }

                        updateAssistantMessageState(assistantMessage, {
                            content: fullReply,
                            thinking: fullThinking,
                            pendingThinking: true
                        });
                    } catch {
                        // Ignore keep-alive or incomplete lines.
                    }
                }
            }

            pending += decoder.decode();
            if (pending.trim()) {
                try {
                    const parsed = JSON.parse(pending);
                    const thinkingToken = parsed?.message?.thinking || '';
                    const contentToken = parsed?.message?.content || '';

                    if (thinkingToken) fullThinking += thinkingToken;
                    if (contentToken) fullReply += contentToken;
                } catch {
                    // Ignore trailing non-JSON content.
                }
            }

            finalizeAssistantMessage();

        } catch (err) {
            if (err?.name === 'AbortError') {
                finalizeAssistantMessage({ aborted: true });
                return;
            }

            assistantMessage.remove();
            let errorMsg = err.message || 'Terjadi error saat menghubungi server proxy.';
            if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
                errorMsg = 'Tidak bisa terhubung ke server lokal. Jalankan `node server.js` dan pastikan `OLLAMA_API_KEY` sudah diset.';
            }
            appendMessageDOM('assistant', `Error: ${errorMsg}`, { modelMeta: selectedModelMeta });
            console.error('API Error:', err);
        } finally {
            activeAbortController = null;
            setSendButtonMode('send');
        }
    }

    sendBtn.addEventListener('click', () => {
        if (activeAbortController) {
            activeAbortController.abort();
            return;
        }
        sendMessage();
    });

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!activeAbortController) {
                sendMessage();
            }
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

        messagesContainer.addEventListener('click', (e) => {
        const toggle = e.target.closest('.thinking-toggle');
        if (!toggle) return;

        const messageDiv = toggle.closest('.message.assistant');
        if (!messageDiv) return;

        const thinkingState = getThinkingState(messageDiv);
        setThinkingExpanded(messageDiv, !thinkingState.expanded, {
            restartAnimation: !thinkingState.expanded && !thinkingState.hasOpenedOnce
        });
    });

    function getThinkingState(messageDiv) {
        let state = thinkingAnimationState.get(messageDiv);
        if (!state) {
            state = {
                targetText: '',
                renderedText: '',
                expanded: false,
                hasOpenedOnce: false,
                animateOnOpen: false,
                pending: false,
                placeholderIndex: 0,
                placeholderHold: 0,
                timerId: null
            };
            thinkingAnimationState.set(messageDiv, state);
        }
        return state;
    }

    function stopThinkingAnimation(messageDiv) {
        const state = getThinkingState(messageDiv);
        if (state.timerId) {
            clearTimeout(state.timerId);
            state.timerId = null;
        }
    }

    function syncThinkingToggleState(messageDiv, expanded) {
        const toggle = messageDiv.querySelector('.thinking-toggle');
        const panel = messageDiv.querySelector('.thinking-panel');
        const caret = messageDiv.querySelector('.thinking-caret');

        if (toggle) {
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }

        if (panel) {
            panel.hidden = !expanded;
        }

        if (caret) {
            caret.classList.toggle('is-open', expanded);
        }
    }

    function renderThinkingBody(messageDiv, text) {
        const thinkingBody = messageDiv.querySelector('.thinking-body');
        if (!thinkingBody) return;

        thinkingBody.innerHTML = text
            ? formatPlainText(text)
            : '<span class="thinking-placeholder">Menyusun proses berpikir model...</span>';
    }

    function animateThinkingText(messageDiv) {
        const state = getThinkingState(messageDiv);
        const placeholder = 'Menyusun proses berpikir model...';

        if (!state.expanded || !state.animateOnOpen) return;
        if (state.timerId) return;

        const step = () => {
            if (!state.expanded || !state.animateOnOpen) {
                state.timerId = null;
                return;
            }

            const latestTarget = state.targetText || '';
            if (latestTarget) {
                if (state.renderedText.length > latestTarget.length) {
                    state.renderedText = '';
                }

                if (state.renderedText.length < latestTarget.length) {
                    const chunkSize = Math.max(1, Math.min(8, Math.ceil((latestTarget.length - state.renderedText.length) / 18)));
                    state.renderedText = latestTarget.slice(0, state.renderedText.length + chunkSize);
                    renderThinkingBody(messageDiv, state.renderedText);
                    state.timerId = setTimeout(step, 18);
                } else {
                    state.renderedText = latestTarget;
                    renderThinkingBody(messageDiv, latestTarget);
                    state.timerId = null;
                }
                return;
            }

            if (state.pending) {
                if (state.placeholderIndex < placeholder.length) {
                    state.placeholderIndex += 1;
                    renderThinkingBody(messageDiv, placeholder.slice(0, state.placeholderIndex));
                    state.timerId = setTimeout(step, 26);
                    return;
                }

                if (state.placeholderHold < 10) {
                    state.placeholderHold += 1;
                    renderThinkingBody(messageDiv, placeholder);
                    state.timerId = setTimeout(step, 40);
                    return;
                }

                state.placeholderIndex = 0;
                state.placeholderHold = 0;
                renderThinkingBody(messageDiv, '');
                state.timerId = setTimeout(step, 120);
                return;
            }

            renderThinkingBody(messageDiv, state.renderedText || latestTarget);
            state.timerId = null;
        };

        step();
    }

    function setThinkingExpanded(messageDiv, expanded, options = {}) {
        const state = getThinkingState(messageDiv);
        state.expanded = expanded;
        syncThinkingToggleState(messageDiv, expanded);

        if (expanded) {
            state.animateOnOpen = Boolean(options.restartAnimation);

            if (state.animateOnOpen) {
                stopThinkingAnimation(messageDiv);
                state.renderedText = '';
                state.placeholderIndex = 0;
                state.placeholderHold = 0;
                state.hasOpenedOnce = true;
                animateThinkingText(messageDiv);
            } else {
                stopThinkingAnimation(messageDiv);
                renderThinkingBody(messageDiv, state.targetText || state.renderedText);
            }
        } else {
            state.animateOnOpen = false;
            stopThinkingAnimation(messageDiv);
        }
    }

    function updateAssistantMessageState(messageDiv, state = {}) {
        const thinkingBox = messageDiv.querySelector('.thinking-block');
        const thinkingLabel = messageDiv.querySelector('.thinking-label');
        const messageBubble = messageDiv.querySelector('.message-bubble');
        const hasThinking = Boolean(state.thinking);
        const isPending = Boolean(state.pendingThinking);
        const thinkingState = getThinkingState(messageDiv);
        const previousTarget = thinkingState.targetText || '';

        if (messageBubble) {
            renderMessageBubble(messageBubble, 'assistant', state.content || '');
        }

        if (!thinkingBox) {
            return;
        }

        if (thinkingLabel) {
            thinkingLabel.textContent = 'Thinking';
        }

        thinkingState.pending = isPending;

        if (hasThinking || isPending) {
            thinkingBox.hidden = false;
            thinkingBox.classList.toggle('is-pending', isPending);
            thinkingState.targetText = state.thinking || '';

            if (!previousTarget && thinkingState.targetText && thinkingState.animateOnOpen) {
                stopThinkingAnimation(messageDiv);
                thinkingState.renderedText = '';
                thinkingState.placeholderIndex = 0;
                thinkingState.placeholderHold = 0;
            }

            syncThinkingToggleState(messageDiv, thinkingState.expanded);

            if (thinkingState.expanded) {
                if (thinkingState.animateOnOpen) {
                    animateThinkingText(messageDiv);
                } else {
                    stopThinkingAnimation(messageDiv);
                    renderThinkingBody(messageDiv, thinkingState.targetText || thinkingState.renderedText);
                }
            }
        } else {
            thinkingBox.hidden = true;
            thinkingBox.classList.remove('is-pending');
            thinkingState.targetText = '';
            thinkingState.pending = false;
            thinkingState.renderedText = '';
            thinkingState.expanded = false;
            thinkingState.hasOpenedOnce = false;
            thinkingState.animateOnOpen = false;
            thinkingState.placeholderIndex = 0;
            thinkingState.placeholderHold = 0;
            stopThinkingAnimation(messageDiv);
            syncThinkingToggleState(messageDiv, false);
            renderThinkingBody(messageDiv, '');
        }

        chatArea.scrollTo({
            top: chatArea.scrollHeight,
            behavior: 'smooth'
        });
    }

    function appendMessageDOM(role, content, messageData = {}) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        let avatarHtml = '';
        if (role === 'user') {
            avatarHtml = `<div class="message-avatar">U</div>`;
        } else {
            const modelMeta = messageData.modelMeta || getActiveModelMeta();
            avatarHtml = `
                <div class="message-avatar">
                    <img src="${modelMeta.logoSrc}" alt="${modelMeta.logoAlt}" onerror="this.onerror=null; this.src='./logo.png'">
                </div>
            `;
        }

        if (role === 'assistant') {
            messageDiv.innerHTML = `
                ${avatarHtml}
                <div class="message-content">
                    <div class="thinking-block" hidden>
                        <button type="button" class="thinking-toggle" aria-expanded="false">
                            <span class="thinking-toggle-main">
                                <i class="ph ph-lightbulb-filament thinking-icon"></i>
                                <span class="thinking-label">Thinking</span><span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                            </span>
                            <i class="ph ph-caret-right thinking-caret"></i>
                        </button>
                        <div class="thinking-panel" hidden>
                            <div class="thinking-body"></div>
                        </div>
                    </div>
                    <div class="message-bubble"></div>
                </div>
            `;

            updateAssistantMessageState(messageDiv, {
                content,
                thinking: messageData.thinking || '',
                pendingThinking: Boolean(messageData.pendingThinking)
            });

            if (typeof messageData.messageIndex === 'number') {
                renderSourcesForAssistant(messageDiv, messageData.messageIndex);
            }
        } else {
            messageDiv.innerHTML = `
                ${avatarHtml}
                <div class="message-content">
                    <div class="message-bubble"></div>
                </div>
            `;

            renderMessageBubble(messageDiv.querySelector('.message-bubble'), 'user', content);

            chatArea.scrollTo({
                top: chatArea.scrollHeight,
                behavior: 'smooth'
            });
        }

        messagesContainer.appendChild(messageDiv);

        // Scroll to bottom
        chatArea.scrollTo({
            top: chatArea.scrollHeight,
            behavior: 'smooth'
        });

        return messageDiv;
    }
});

