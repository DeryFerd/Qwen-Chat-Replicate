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
    const attachmentStrip = document.getElementById('attachment-strip');
    const imageInput = document.getElementById('image-input');
    const attachBtn = document.querySelector('.attach-btn');
    const voiceBtn = document.querySelector('.voice-btn');
    const thinkingToggleBtn = document.getElementById('thinking-toggle-btn');
    const webSearchToggleBtn = document.getElementById('web-search-toggle-btn');
    const installAppBtn = document.getElementById('install-app-btn');
    const systemPromptBtn = document.getElementById('system-prompt-btn');
    const systemPromptModal = document.getElementById('system-prompt-modal');
    const systemPromptTextarea = document.getElementById('system-prompt-textarea');
    const systemPromptCounter = document.getElementById('system-prompt-counter');
    const systemPromptSaveBtn = document.getElementById('system-prompt-save-btn');
    const systemPromptResetBtn = document.getElementById('system-prompt-reset-btn');
    const systemPromptIndicator = document.getElementById('system-prompt-indicator');
    const shortcutsModal = document.getElementById('shortcuts-modal');
    const sidebarSearchInput = document.getElementById('chat-search-input');
    const sidebarSearchClear = document.getElementById('chat-search-clear');
    const brandLogo = document.querySelector('.brand-logo');
    const brandName = document.querySelector('.brand-name');
    const welcomeLogo = document.querySelector('.welcome-logo');
    const welcomeTitle = document.querySelector('.welcome-title');
    const welcomeSubtitle = document.querySelector('.welcome-subtitle');
    const suggestionGrid = document.querySelector('.suggestion-grid');

    const CHAT_API_URL = '/api/chat';

    // --- state management ---
    let chats = JSON.parse(localStorage.getItem('qwen_chats') || '[]');
    let currentChatId = null;
    let currentMessages = [];
    let botResponseTimeout = null;
    let activeAbortController = null;
    let attachedImages = [];
    let speechRecognition = null;
    let isListening = false;
    let thinkingEnabled = false;
    let webSearchEnabled = true;
    let currentSystemPrompt = localStorage.getItem('qwen_system_prompt') || '';
    let deferredInstallPrompt = null;
    let sidebarSearchQuery = '';
    let sidebarSearchDebounce = null;
    const thinkingAnimationState = new WeakMap();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }

    function getSelectedModel() {
        const active = document.querySelector('.model-option.active');
        return active ? active.getAttribute('data-model') : 'qwen3.5:397b-cloud';
    }

    function getActiveModelOption() {
        return document.querySelector('.model-option.active');
    }

    function getModelMetaFromOption(option) {
        return {
            label: option?.getAttribute('data-label') || 'Qwen3.5 397B',
            logoSrc: option?.getAttribute('data-logo') || './assets/models/qwen.png',
            logoAlt: option?.getAttribute('data-alt') || 'Qwen',
            brandName: option?.getAttribute('data-brand') || option?.getAttribute('data-label') || 'Qwen'
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
            if (Array.isArray(content)) {
                messageBubble.innerHTML = '';
                content.forEach(item => {
                    if (item?.type === 'image_url') {
                        const img = document.createElement('img');
                        img.className = 'attachment-inline';
                        img.src = item?.image_url?.url || '';
                        img.alt = 'Attachment';
                        messageBubble.appendChild(img);
                        return;
                    }
                    if (item?.type === 'text') {
                        const textBlock = document.createElement('div');
                        textBlock.className = 'user-text-block';
                        textBlock.innerHTML = formatPlainText(item?.text || '');
                        messageBubble.appendChild(textBlock);
                    }
                });
            } else {
                messageBubble.innerHTML = formatPlainText(content);
            }
        }
    }

    const SUGGESTION_SETS = {
        coder: [
            { icon: 'ph-code', title: 'Generate code', desc: 'for a REST API endpoint' },
            { icon: 'ph-bug', title: 'Debug error', desc: 'from stack trace or logs' },
            { icon: 'ph-brackets-curly', title: 'Refactor code', desc: 'to improve performance' },
            { icon: 'ph-terminal', title: 'Explain code', desc: 'line by line in simple terms' }
        ],
        multimodal: [
            { icon: 'ph-image', title: 'Describe image', desc: 'with key details and objects' },
            { icon: 'ph-text-aa', title: 'Extract text', desc: 'from a screenshot or photo' },
            { icon: 'ph-magnifying-glass-plus', title: 'Analyze diagram', desc: 'and summarize insights' },
            { icon: 'ph-palette', title: 'Design critique', desc: 'for a UI mockup image' }
        ],
        general: [
            { icon: 'ph-pencil-simple', title: 'Draft an email', desc: 'asking for a project update' },
            { icon: 'ph-code', title: 'Write Python code', desc: 'to scrape a simple website' },
            { icon: 'ph-lightbulb', title: 'Brainstorm ideas', desc: 'for a sci-fi short story' },
            { icon: 'ph-book-open', title: 'Summarize', desc: 'the plot of inception' }
        ]
    };

    function getModelCategory() {
        const option = getActiveModelOption();
        const category = option?.getAttribute('data-category');
        if (category === 'coder' || category === 'multimodal') {
            return category;
        }
        return 'general';
    }

    function renderSuggestions(category) {
        if (!suggestionGrid) return;
        const suggestions = SUGGESTION_SETS[category] || SUGGESTION_SETS.general;
        suggestionGrid.innerHTML = suggestions.map((item) => `
            <button class="suggestion-card">
                <i class="ph ${item.icon} suggestions-icon"></i>
                <div class="suggestion-text">
                    <span class="suggestion-title">${escapeHtml(item.title)}</span>
                    <span class="suggestion-desc">${escapeHtml(item.desc)}</span>
                </div>
            </button>
        `).join('');
    }

    function updateBrandingUI(modelMeta) {
        if (brandLogo) {
            brandLogo.src = modelMeta.logoSrc;
            brandLogo.alt = modelMeta.logoAlt || modelMeta.brandName || 'Model';
        }
        if (brandName) {
            brandName.textContent = modelMeta.brandName;
        }
        if (welcomeLogo) {
            welcomeLogo.src = modelMeta.logoSrc;
            welcomeLogo.alt = modelMeta.logoAlt || modelMeta.brandName || 'Model';
        }
        if (welcomeTitle) {
            welcomeTitle.textContent = `Hi, I'm ${modelMeta.brandName}`;
        }
        if (welcomeSubtitle) {
            welcomeSubtitle.textContent = 'How can I help you today?';
        }
        if (chatInput) {
            const brandLabel = modelMeta.brandName || modelMeta.label || 'Qwen';
            chatInput.placeholder = `Message ${brandLabel}...`;
        }
    }

    function updateSuggestionsForModel() {
        renderSuggestions(getModelCategory());
    }

    function updateThinkingToggleUI() {
        if (!thinkingToggleBtn) return;
        thinkingToggleBtn.classList.toggle('is-active', thinkingEnabled);
        const icon = thinkingToggleBtn.querySelector('i');
        if (icon) {
            icon.className = thinkingEnabled ? 'ph ph-brain ph-fill' : 'ph ph-brain';
        } else {
            thinkingToggleBtn.innerHTML = '<i class="ph ph-brain"></i>';
        }
        thinkingToggleBtn.title = thinkingEnabled ? 'Disable thinking (Ctrl+Shift+T)' : 'Enable thinking (Ctrl+Shift+T)';
    }

    function updateWebSearchToggleUI() {
        if (!webSearchToggleBtn) return;
        webSearchToggleBtn.classList.toggle('is-active', webSearchEnabled);
        const icon = webSearchToggleBtn.querySelector('i');
        if (icon) {
            icon.className = webSearchEnabled ? 'ph ph-globe ph-fill' : 'ph ph-globe';
        } else {
            webSearchToggleBtn.innerHTML = '<i class="ph ph-globe"></i>';
        }
        webSearchToggleBtn.title = webSearchEnabled ? 'Web search enabled (Ctrl+Shift+W)' : 'Web search disabled (Ctrl+Shift+W)';
    }

    function modelSupportsThinking(modelId) {
        const option = getActiveModelOption();
        const attr = option?.getAttribute('data-thinking');
        if (attr !== null && attr !== undefined) {
            return attr === 'true';
        }
        return String(modelId || '').toLowerCase().includes('qwen3');
    }

    function modelSupportsVision(modelId) {
        const option = getActiveModelOption();
        const attr = option?.getAttribute('data-vision');
        if (attr !== null && attr !== undefined) {
            return attr === 'true';
        }
        return String(modelId || '').toLowerCase().includes('vl');
    }

    function updateAttachmentAvailability() {
        if (!attachBtn || !imageInput) return;
        const modelId = getSelectedModel();
        const supportsVision = modelSupportsVision(modelId);
        attachBtn.classList.toggle('is-disabled', !supportsVision);
        attachBtn.title = supportsVision ? 'Attach image' : 'Switch to Qwen3 VL to send images';
        imageInput.disabled = !supportsVision;
        if (!supportsVision && attachedImages.length) {
            clearAttachments();
        }
    }

    function renderAttachmentStrip() {
        if (!attachmentStrip) return;

        attachmentStrip.innerHTML = '';

        if (!attachedImages.length) {
            attachmentStrip.hidden = true;
            return;
        }

        attachmentStrip.hidden = false;
        attachedImages.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'attachment-thumb';

            const img = document.createElement('img');
            img.src = item.dataUrl;
            img.alt = item.name || 'Attachment';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'attachment-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', () => {
                attachedImages.splice(index, 1);
                renderAttachmentStrip();
            });

            card.appendChild(img);
            card.appendChild(removeBtn);
            attachmentStrip.appendChild(card);
        });
    }

    function buildUserMessageContent(text) {
        if (!attachedImages.length) {
            return text;
        }

        const parts = attachedImages.map(item => ({
            type: 'image_url',
            image_url: { url: item.dataUrl }
        }));

        if (text) {
            parts.push({
                type: 'text',
                text
            });
        }

        return parts;
    }

    function clearAttachments() {
        attachedImages = [];
        renderAttachmentStrip();
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
        if (!results.length) return false;

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
        return true;
    }

    function updateToolActivity(messageDiv, text) {
        if (!messageDiv) return;
        const activity = messageDiv.querySelector('.tool-activity');
        if (!activity) return;
        if (text) {
            activity.textContent = text;
            activity.hidden = false;
        } else {
            activity.hidden = true;
        }
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

    const initialOption = document.querySelector('.model-option.active');
    syncSelectedModelDisplay(initialOption);
    updateBrandingUI(getModelMetaFromOption(initialOption));
    updateSuggestionsForModel();

    function updateCurrentChatModel(modelId) {
        if (!currentChatId) return;
        const index = chats.findIndex(c => c.id === currentChatId);
        if (index === -1) return;
        chats[index].modelId = modelId;
        saveChats();
        renderSidebar();
    }

    function setActiveModelOption(option, { persist = false } = {}) {
        if (!option) return;
        modelOptions.forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        syncSelectedModelDisplay(option);
        updateModelDependentToggles();

        if (persist) {
            updateCurrentChatModel(option.getAttribute('data-model'));
        }
    }

    function setActiveModelById(modelId, { persist = false } = {}) {
        if (!modelId) return;
        const option = Array.from(modelOptions).find(opt => opt.getAttribute('data-model') === modelId);
        if (option) {
            setActiveModelOption(option, { persist });
        }
    }

    modelOptions.forEach(option => {
        option.addEventListener('click', () => {
            setActiveModelOption(option, { persist: true });
            modelSelector.classList.remove('open');
        });
    });

    function updateModelDependentToggles() {
        const modelId = getSelectedModel();
        thinkingEnabled = modelSupportsThinking(modelId);
        updateThinkingToggleUI();
        updateAttachmentAvailability();
        updateBrandingUI(getActiveModelMeta());
        updateSuggestionsForModel();
    }

    updateModelDependentToggles();
    updateWebSearchToggleUI();

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

    function extractMessageText(message) {
        if (!message) return '';
        if (Array.isArray(message.content)) {
            return message.content
                .filter(item => item?.type === 'text')
                .map(item => item?.text || '')
                .join(' ');
        }
        return message.content || '';
    }

    function highlightMatch(text, query) {
        if (!query) return escapeHtml(text || '');
        const safeText = text || '';
        const escaped = escapeHtml(safeText);
        const escapedQuery = escapeHtml(query);
        const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'ig');
        return escaped.replace(regex, '<mark>$1</mark>');
    }

    function filterChatsByQuery(items, query) {
        if (!query) return items;
        const lower = query.toLowerCase();
        return items.filter(chat => {
            const titleMatch = (chat.title || '').toLowerCase().includes(lower);
            if (titleMatch) return true;
            return (chat.messages || []).some(msg => extractMessageText(msg).toLowerCase().includes(lower));
        });
    }

    function renderSidebar() {
        const filteredChats = filterChatsByQuery(chats, sidebarSearchQuery);

        // Group chats
        const now = new Date();
        const today = [];
        const yesterday = [];
        const previous = [];

        filteredChats.forEach(chat => {
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
                const renderedTitle = sidebarSearchQuery ? highlightMatch(chat.title || '', sidebarSearchQuery) : escapeHtml(chat.title || '');
                html += `
                    <li>
                        <a href="#" class="history-item" data-id="${chat.id}">
                            <i class="ph ph-chat-teardrop-text"></i>
                            <span class="${titleClass}">${renderedTitle}</span>
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

        if (sidebarSearchQuery && filteredChats.length === 0) {
            sidebarContent.innerHTML = `
                <div class="history-empty-state">
                    <span>No results found</span>
                </div>
            `;
        }

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
        if (chat.modelId) {
            setActiveModelById(chat.modelId, { persist: false });
        }

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
                modelId: getSelectedModel(),
                updatedAt: new Date().toISOString()
            };
            chats.unshift(newChat); // add to top
        } else {
            // Update existing
            const index = chats.findIndex(c => c.id === currentChatId);
            if (index !== -1) {
                chats[index].messages = currentMessages;
                chats[index].modelId = getSelectedModel();
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

    function fallbackTitleFromMessage(message) {
        const text = extractMessageText(message).trim();
        if (!text) return '';
        return text.split(/\s+/).slice(0, 6).join(' ');
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
                    'Content-Type': 'application/json',
                    'X-Disable-Web-Search': 'true'
                },
                body: JSON.stringify({
                    model: getSelectedModel(),
                    stream: false,
                    think: false,
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

            const contentType = response.headers.get('content-type') || '';
            let rawTitle = '';

            if (contentType.includes('application/json')) {
                const payload = await response.json();
                rawTitle = payload?.message?.content || payload?.response || '';
            } else {
                const rawText = await response.text();
                if (rawText) {
                    const lines = rawText.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line);
                            const chunk = parsed?.message?.content || parsed?.response || '';
                            if (chunk) rawTitle += chunk;
                        } catch {
                            // Ignore malformed lines.
                        }
                    }

                    if (!rawTitle) {
                        try {
                            const parsed = JSON.parse(rawText);
                            rawTitle = parsed?.message?.content || parsed?.response || '';
                        } catch {
                            // Ignore non-JSON fallback.
                        }
                    }
                }
            }
            const title = normalizeChatTitle(rawTitle);

            const finalTitle = title || normalizeChatTitle(fallbackTitleFromMessage(convoMessages[0]));
            if (!finalTitle) return;

            chats[index].title = finalTitle;
            chats[index].titlePending = false;
            chats[index].updatedAt = new Date().toISOString();
            saveChats();
            renderSidebar();
        } catch {
            // Leave the placeholder title if generation fails.
        }
    }

    function buildRequestMessages() {
        const messages = currentMessages.map(message => {
            if (message.role === 'tool') {
                return {
                    role: 'tool',
                    tool_name: message.tool_name,
                    content: message.content
                };
            }
            return {
                role: message.role,
                content: message.content
            };
        });

        if (currentSystemPrompt && currentSystemPrompt.trim()) {
            return [
                { role: 'system', content: currentSystemPrompt.trim() },
                ...messages
            ];
        }

        return messages;
    }

    function showOfflineNotice() {
        const existing = document.querySelector('.offline-notice');
        if (existing) return;

        if (welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
            messagesContainer.style.display = 'flex';
        }

        const notice = document.createElement('div');
        notice.className = 'offline-notice';
        notice.textContent = 'You are offline. Reconnect to continue chatting.';
        messagesContainer.appendChild(notice);
    }

    function updateSystemPromptIndicator() {
        if (!systemPromptIndicator) return;
        const hasPrompt = Boolean(currentSystemPrompt && currentSystemPrompt.trim());
        systemPromptIndicator.hidden = !hasPrompt;
        systemPromptIndicator.classList.toggle('is-active', hasPrompt);
    }

    function updateSystemPromptCounter() {
        if (!systemPromptTextarea || !systemPromptCounter) return;
        systemPromptCounter.textContent = `${systemPromptTextarea.value.length} / 2000`;
    }

    function openSystemPromptModal() {
        if (!systemPromptModal || !systemPromptTextarea) return;
        systemPromptTextarea.value = currentSystemPrompt || '';
        updateSystemPromptCounter();
        systemPromptModal.classList.add('show');
        systemPromptTextarea.focus();
    }

    function closeSystemPromptModal() {
        if (!systemPromptModal) return;
        systemPromptModal.classList.remove('show');
    }

    // Initialize sidebar
    renderSidebar();

    if (sidebarSearchInput) {
        sidebarSearchInput.addEventListener('input', () => {
            if (sidebarSearchDebounce) {
                clearTimeout(sidebarSearchDebounce);
            }
            sidebarSearchDebounce = setTimeout(() => {
                sidebarSearchQuery = sidebarSearchInput.value.trim();
                renderSidebar();
            }, 300);

            if (sidebarSearchInput.value.trim()) {
                sidebarSearchClear.classList.add('show');
            } else {
                sidebarSearchClear.classList.remove('show');
            }
        });
    }

    if (sidebarSearchClear) {
        sidebarSearchClear.addEventListener('click', () => {
            sidebarSearchQuery = '';
            if (sidebarSearchInput) {
                sidebarSearchInput.value = '';
                sidebarSearchInput.focus();
            }
            sidebarSearchClear.classList.remove('show');
            renderSidebar();
        });
    }

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
            clearAttachments();

            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
    }

    if (attachBtn && imageInput) {
        attachBtn.addEventListener('click', () => {
            if (attachBtn.classList.contains('is-disabled')) {
                return;
            }
            imageInput.click();
        });

        imageInput.addEventListener('change', () => {
            const files = Array.from(imageInput.files || []);
            files.forEach(file => {
                if (!file.type.startsWith('image/')) return;
                const reader = new FileReader();
                reader.onload = () => {
                    attachedImages.push({
                        name: file.name,
                        dataUrl: reader.result
                    });
                    renderAttachmentStrip();
                };
                reader.readAsDataURL(file);
            });
            imageInput.value = '';
        });
    }

    if (thinkingToggleBtn) {
        thinkingToggleBtn.addEventListener('click', () => {
            thinkingEnabled = !thinkingEnabled;
            updateThinkingToggleUI();
        });
    }

    if (webSearchToggleBtn) {
        webSearchToggleBtn.addEventListener('click', () => {
            webSearchEnabled = !webSearchEnabled;
            updateWebSearchToggleUI();
        });
    }

    function stopVoiceRecognition() {
        if (!speechRecognition) return;
        speechRecognition.stop();
    }

    function setVoiceListening(listening) {
        isListening = listening;
        if (voiceBtn) {
            voiceBtn.classList.toggle('is-listening', listening);
        }
        chatInput.classList.toggle('is-interim', listening);
    }

    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            if (voiceBtn) {
                voiceBtn.title = 'Voice input not supported in this browser';
            }
            return null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        try {
            recognition.lang = 'id-ID';
        } catch {
            recognition.lang = 'en-US';
        }
        recognition.onerror = () => {
            setVoiceListening(false);
        };
        recognition.onend = () => {
            setVoiceListening(false);
        };
        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const transcript = event.results[i][0]?.transcript || '';
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            const text = finalTranscript || interimTranscript;
            chatInput.value = text.trim();
            chatInput.dispatchEvent(new Event('input'));
            if (finalTranscript) {
                chatInput.classList.remove('is-interim');
            } else {
                chatInput.classList.add('is-interim');
            }
        };

        return recognition;
    }

    async function requestMicrophoneAccess() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return true;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch {
            if (voiceBtn) {
                voiceBtn.title = 'Microphone permission denied';
            }
            return false;
        }
    }

    if (voiceBtn) {
        speechRecognition = initSpeechRecognition();
        voiceBtn.addEventListener('click', async () => {
            if (!speechRecognition) {
                return;
            }

            if (isListening) {
                stopVoiceRecognition();
                return;
            }

            setVoiceListening(true);
            const allowed = await requestMicrophoneAccess();
            if (!allowed) {
                setVoiceListening(false);
                return;
            }

            try {
                speechRecognition.start();
            } catch {
                setVoiceListening(false);
            }
        });
    }

    updateSystemPromptIndicator();

    if (systemPromptBtn) {
        systemPromptBtn.addEventListener('click', openSystemPromptModal);
    }

    if (systemPromptTextarea) {
        systemPromptTextarea.addEventListener('input', updateSystemPromptCounter);
    }

    if (systemPromptSaveBtn) {
        systemPromptSaveBtn.addEventListener('click', () => {
            currentSystemPrompt = systemPromptTextarea.value.trim();
            if (currentSystemPrompt) {
                localStorage.setItem('qwen_system_prompt', currentSystemPrompt);
            } else {
                localStorage.removeItem('qwen_system_prompt');
            }
            updateSystemPromptIndicator();
            closeSystemPromptModal();
        });
    }

    if (systemPromptResetBtn) {
        systemPromptResetBtn.addEventListener('click', () => {
            currentSystemPrompt = '';
            if (systemPromptTextarea) {
                systemPromptTextarea.value = '';
                updateSystemPromptCounter();
            }
            localStorage.removeItem('qwen_system_prompt');
            updateSystemPromptIndicator();
        });
    }

    if (systemPromptModal) {
        systemPromptModal.addEventListener('click', (event) => {
            if (event.target === systemPromptModal) {
                closeSystemPromptModal();
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
        if (!text && attachedImages.length === 0) return;
        if (activeAbortController) return;

        if (welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
            messagesContainer.style.display = 'flex';
        }

        const messageContent = buildUserMessageContent(text);
        currentMessages.push({ role: 'user', content: messageContent });
        appendMessageDOM('user', messageContent);
        saveCurrentChat();

        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.setAttribute('disabled', 'true');
        clearAttachments();

        const selectedModelMeta = getActiveModelMeta();
        const supportsThinking = modelSupportsThinking(getSelectedModel());
        const enableThinking = thinkingEnabled && supportsThinking;
        let fullReply = '';
        let fullThinking = '';

        const assistantMessage = appendMessageDOM('assistant', '', {
            modelMeta: selectedModelMeta,
            pendingThinking: enableThinking,
            forceThinking: enableThinking
        });
        assistantMessage.dataset.webSearchUsed = 'false';
        updateToolActivity(assistantMessage, '');
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
                thinking: enableThinking ? fullThinking : '',
                pendingThinking: false,
                forceThinking: enableThinking
            });

            if (pendingToolMessages.length) {
                currentMessages.push(...pendingToolMessages);
            }

            currentMessages.push({
                role: 'assistant',
                content: fullReply,
                thinking: enableThinking ? fullThinking : '',
                modelMeta: selectedModelMeta
            });
            saveCurrentChat();
            const hasSources = renderSourcesForAssistant(assistantMessage, currentMessages.length - 1);
            if (assistantMessage.dataset.webSearchUsed === 'true' && !hasSources) {
                updateToolActivity(assistantMessage, 'Web search used');
            } else {
                updateToolActivity(assistantMessage, '');
            }

            if (!aborted) {
                generateTitleIfNeeded();
            }
        };

        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            if (!webSearchEnabled) {
                headers['X-Disable-Web-Search'] = 'true';
            }

            const requestPayload = {
                model: getSelectedModel(),
                messages: buildRequestMessages(),
                stream: true,
                ...(supportsThinking ? { think: enableThinking } : {})
            };

            const response = await fetch(CHAT_API_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestPayload),
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
                fullThinking = enableThinking ? (payload?.message?.thinking || payload?.thinking || '') : '';

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
                        const toolCalls = parsed?.message?.tool_calls;
                        const isToolMessage = role === 'tool' || Boolean(toolName);

                        if (thinkingToken && !isToolMessage && enableThinking) fullThinking += thinkingToken;
                        if (contentToken && !isToolMessage) fullReply += contentToken;
                        if (toolName) {
                            pendingToolMessages.push({
                                role: 'tool',
                                tool_name: toolName,
                                content: parsed?.message?.content || ''
                            });
                        }
                        if (Array.isArray(toolCalls) && toolCalls.some(call => call?.function?.name === 'web_search')) {
                            assistantMessage.dataset.webSearchUsed = 'true';
                            updateToolActivity(assistantMessage, 'Searching the web...');
                        }

                        updateAssistantMessageState(assistantMessage, {
                            content: fullReply,
                            thinking: enableThinking ? fullThinking : '',
                            pendingThinking: enableThinking,
                            forceThinking: enableThinking
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

                    if (thinkingToken && enableThinking) fullThinking += thinkingToken;
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

            if (navigator && navigator.onLine === false) {
                assistantMessage.remove();
                showOfflineNotice();
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

    function closeAllOverlays() {
        if (systemPromptModal) systemPromptModal.classList.remove('show');
        if (shortcutsModal) shortcutsModal.classList.remove('show');
        if (modelSelector) modelSelector.classList.remove('open');
        hideGlobalDropdown();
        const deleteModal = document.getElementById('delete-modal');
        if (deleteModal) deleteModal.classList.remove('show');
    }

    function openShortcutsModal() {
        if (!shortcutsModal) return;
        shortcutsModal.classList.add('show');
    }

    function isEditableTarget(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    }

    document.addEventListener('keydown', (event) => {
        const key = event.key;
        const targetIsEditable = isEditableTarget(event.target);

        if (key === 'Escape') {
            closeAllOverlays();
            return;
        }

        if (key === '?' && !targetIsEditable) {
            event.preventDefault();
            openShortcutsModal();
            return;
        }

        if (event.ctrlKey && key.toLowerCase() === 'k') {
            event.preventDefault();
            if (sidebarSearchInput) {
                sidebarSearchInput.focus();
            }
            return;
        }

        if (event.ctrlKey && key.toLowerCase() === 'n') {
            event.preventDefault();
            newChatBtn?.click();
            return;
        }

        if (event.ctrlKey && key === '/') {
            event.preventDefault();
            openSystemPromptModal();
            return;
        }

        if (event.ctrlKey && event.shiftKey && key.toLowerCase() === 't') {
            event.preventDefault();
            thinkingEnabled = !thinkingEnabled;
            updateThinkingToggleUI();
            return;
        }

        if (event.ctrlKey && event.shiftKey && key.toLowerCase() === 'w') {
            event.preventDefault();
            webSearchEnabled = !webSearchEnabled;
            updateWebSearchToggleUI();
            return;
        }
    });

    if (shortcutsModal) {
        shortcutsModal.addEventListener('click', (event) => {
            if (event.target === shortcutsModal) {
                shortcutsModal.classList.remove('show');
            }
        });
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (installAppBtn) {
            installAppBtn.hidden = false;
        }
    });

    if (installAppBtn) {
        installAppBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            installAppBtn.hidden = true;
        });
    }

    // Suggestion Cards Click (delegated)
    if (suggestionGrid) {
        suggestionGrid.addEventListener('click', (event) => {
            const card = event.target.closest('.suggestion-card');
            if (!card) return;
            const title = card.querySelector('.suggestion-title')?.textContent || '';
            const desc = card.querySelector('.suggestion-desc')?.textContent || '';
            chatInput.value = `${title} ${desc}`.trim();
            chatInput.dispatchEvent(new Event('input')); // trigger resize and button state
            chatInput.focus();
        });
    }

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
                emptyNotice: '',
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

    function renderThinkingBody(messageDiv, text, placeholderText) {
        const thinkingBody = messageDiv.querySelector('.thinking-body');
        if (!thinkingBody) return;

        if (text) {
            thinkingBody.innerHTML = formatPlainText(text);
            return;
        }

        if (placeholderText) {
            thinkingBody.innerHTML = `<span class="thinking-placeholder">${escapeHtml(placeholderText)}</span>`;
            return;
        }

        thinkingBody.innerHTML = '<span class="thinking-placeholder">Menyusun proses berpikir model...</span>';
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
                const displayText = state.targetText || state.renderedText;
                renderThinkingBody(messageDiv, displayText, state.emptyNotice);
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
        const forceThinking = Boolean(state.forceThinking);
        const shouldShowThinking = forceThinking || hasThinking || isPending;
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

        thinkingState.emptyNotice = '';

        if (shouldShowThinking) {
            thinkingBox.hidden = false;
            thinkingBox.classList.toggle('is-pending', isPending);
            thinkingState.targetText = state.thinking || '';
            if (forceThinking && !hasThinking && !isPending) {
                thinkingState.emptyNotice = 'Tidak ada jejak thinking dari model.';
            }

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
                    const displayText = thinkingState.targetText || thinkingState.renderedText;
                    renderThinkingBody(messageDiv, displayText, thinkingState.emptyNotice);
                }
            } else if (thinkingState.emptyNotice) {
                renderThinkingBody(messageDiv, '', thinkingState.emptyNotice);
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
            thinkingState.emptyNotice = '';
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
                    <div class="tool-activity" hidden></div>
                    <div class="message-bubble"></div>
                </div>
            `;

            updateAssistantMessageState(messageDiv, {
                content,
                thinking: messageData.thinking || '',
                pendingThinking: Boolean(messageData.pendingThinking),
                forceThinking: Boolean(messageData.forceThinking)
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

