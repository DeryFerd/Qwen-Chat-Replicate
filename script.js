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
    const memoryBtn = document.getElementById('memory-btn');
    const memoryModal = document.getElementById('memory-modal');
    const memoryList = document.getElementById('memory-list');
    const memoryEmpty = document.getElementById('memory-empty');
    const memoryInput = document.getElementById('memory-input');
    const memoryAddBtn = document.getElementById('memory-add-btn');
    const memoryClearBtn = document.getElementById('memory-clear-btn');
    const memoryCounter = document.getElementById('memory-counter');
    const memoryCloseBtn = document.getElementById('memory-close-btn');
    const personaBar = document.getElementById('persona-bar');
    const shortcutsModal = document.getElementById('shortcuts-modal');
    const sidebarSearchInput = document.getElementById('chat-search-input');
    const sidebarSearchClear = document.getElementById('chat-search-clear');
    const userProfileBtn = document.querySelector('.user-profile-btn');
    const userNameLabel = document.querySelector('.username');
    const userAvatar = document.querySelector('.avatar');
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
    let activePersonaId = null;
    let activeTagFilter = null;
    let tagEditorChatId = null;
    let userMemories = [];
    let currentUserProfile = { id: 'default', name: 'User' };
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

    const PERSONAS = [
        {
            id: 'default',
            label: 'Default',
            icon: 'ph-sparkle',
            prompt: ''
        },
        {
            id: 'coder',
            label: 'Coding Assistant',
            icon: 'ph-code',
            prompt: 'You are an expert software engineer. Be concise and precise. Always prefer code examples over long explanations. Use markdown for all code blocks.'
        },
        {
            id: 'tutor',
            label: 'Tutor',
            icon: 'ph-graduation-cap',
            prompt: 'You are a patient and encouraging tutor. Break down complex topics into simple steps. Ask clarifying questions when needed. Use analogies and examples.'
        },
        {
            id: 'writer',
            label: 'Creative Writer',
            icon: 'ph-pencil-line',
            prompt: 'You are a creative writing assistant. Be imaginative, expressive, and help craft compelling narratives, dialogue, and descriptions.'
        },
        {
            id: 'analyst',
            label: 'Analyst',
            icon: 'ph-chart-line-up',
            prompt: 'You are a sharp analytical thinker. Structure your responses clearly. Use bullet points, pros/cons lists, and data-driven reasoning. Be objective.'
        }
    ];

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

    function getPersonaById(id) {
        return PERSONAS.find(persona => persona.id === id);
    }

    function renderPersonaBar() {
        if (!personaBar) return;
        personaBar.innerHTML = PERSONAS.map(persona => `
            <button class="persona-chip${activePersonaId === persona.id ? ' is-active' : ''}" data-id="${persona.id}">
                <i class="ph ${persona.icon}"></i>
                <span>${persona.label}</span>
            </button>
        `).join('');
    }

    function setActivePersona(id) {
        activePersonaId = id;
        const persona = getPersonaById(id);
        if (persona && systemPromptTextarea) {
            systemPromptTextarea.value = persona.prompt;
            updateSystemPromptCounter();
        }
        renderPersonaBar();
        updateSystemPromptIndicator();
    }

    function syncPersonaFromTextarea() {
        if (!systemPromptTextarea || !activePersonaId) return;
        const persona = getPersonaById(activePersonaId);
        const targetPrompt = persona?.prompt ?? '';
        if (systemPromptTextarea.value !== targetPrompt) {
            activePersonaId = null;
            renderPersonaBar();
            updateSystemPromptIndicator();
        }
    }

    function slugifyUserId(name) {
        const slug = String(name || '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        if (slug) return slug.slice(0, 40);
        return `user-${Math.random().toString(16).slice(2, 10)}`;
    }

    function loadUserProfile() {
        try {
            const raw = JSON.parse(localStorage.getItem('qwen_user_profile') || '{}');
            if (raw?.id && raw?.name) {
                return {
                    id: String(raw.id),
                    name: String(raw.name)
                };
            }
        } catch {
            // Ignore malformed storage.
        }

        const fallback = { id: 'default', name: 'User' };
        localStorage.setItem('qwen_user_profile', JSON.stringify(fallback));
        return fallback;
    }

    function saveUserProfile(profile) {
        if (!profile) return;
        localStorage.setItem('qwen_user_profile', JSON.stringify(profile));
    }

    function updateUserProfileUI() {
        if (userNameLabel) {
            userNameLabel.textContent = currentUserProfile?.name || 'User';
        }
        if (userAvatar) {
            const name = currentUserProfile?.name || 'U';
            userAvatar.textContent = name.trim().charAt(0).toUpperCase() || 'U';
        }
    }

    function getMemoryStorageKey(userId) {
        return `qwen_user_memory_${userId || 'default'}`;
    }

    function normalizeMemoryEntry(entry) {
        const text = String(entry?.text || '').trim().slice(0, 120);
        if (!text) return null;
        return {
            id: String(entry?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
            text,
            createdAt: entry?.createdAt || new Date().toISOString()
        };
    }

    function loadMemories() {
        const userId = currentUserProfile?.id || 'default';
        const storageKey = getMemoryStorageKey(userId);
        const legacyRaw = localStorage.getItem('qwen_user_memory');
        try {
            const rawSource = localStorage.getItem(storageKey) || legacyRaw || '[]';
            const raw = JSON.parse(rawSource || '[]');
            userMemories = Array.isArray(raw)
                ? raw.map(normalizeMemoryEntry).filter(Boolean).slice(0, 20)
                : [];
            if (!localStorage.getItem(storageKey) && legacyRaw) {
                localStorage.setItem(storageKey, JSON.stringify(userMemories));
            }
        } catch {
            userMemories = [];
        }
    }

    function saveMemories() {
        const userId = currentUserProfile?.id || 'default';
        const payload = JSON.stringify(userMemories.slice(0, 20));
        localStorage.setItem(getMemoryStorageKey(userId), payload);
        localStorage.setItem('qwen_user_memory', payload);
    }

    function isMemoryDuplicate(text) {
        const lowered = text.toLowerCase();
        return userMemories.some(entry => {
            const existing = entry.text.toLowerCase();
            return existing.includes(lowered) || lowered.includes(existing);
        });
    }

    function addMemoryText(text) {
        const normalized = String(text || '').trim().slice(0, 120);
        if (!normalized) return false;
        if (isMemoryDuplicate(normalized)) return false;
        if (userMemories.length >= 20) return false;

        userMemories.unshift({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            text: normalized,
            createdAt: new Date().toISOString()
        });
        saveMemories();
        return true;
    }

    function renderMemoryList() {
        if (!memoryList || !memoryEmpty) return;
        memoryList.innerHTML = '';
        if (!userMemories.length) {
            memoryEmpty.hidden = false;
            return;
        }
        memoryEmpty.hidden = true;
        userMemories.forEach(entry => {
            const chip = document.createElement('div');
            chip.className = 'memory-chip';
            chip.innerHTML = `
                <span>${escapeHtml(entry.text)}</span>
                <button type="button" data-id="${entry.id}" title="Remove">&times;</button>
            `;
            memoryList.appendChild(chip);
        });
    }

    function updateMemoryCounter() {
        if (!memoryCounter || !memoryInput) return;
        memoryCounter.textContent = `${memoryInput.value.length} / 120`;
    }

    function submitMemoryInput() {
        if (!memoryInput) return;
        const value = memoryInput.value.trim();
        if (!value) return;
        const added = addMemoryText(value);
        if (added) {
            memoryInput.value = '';
            updateMemoryCounter();
            renderMemoryList();
        }
    }

    function openMemoryModal() {
        if (!memoryModal) return;
        renderMemoryList();
        updateMemoryCounter();
        memoryModal.classList.add('show');
        memoryInput?.focus();
    }

    function closeMemoryModal() {
        if (!memoryModal) return;
        memoryModal.classList.remove('show');
    }

    async function extractMemoryFromLastTurn() {
        const lastUser = [...currentMessages].reverse().find(msg => msg.role === 'user');
        const lastAssistant = [...currentMessages].reverse().find(msg => msg.role === 'assistant');
        if (!lastUser || !lastAssistant) return;

        const systemPrompt = 'You are a memory extraction assistant. Given the conversation, extract 0-3 SHORT factual statements about the USER ONLY (not the AI) that are worth remembering long-term (name, profession, preferences, goals, location, etc). Return ONLY a JSON array of strings, no explanation, no markdown. Example: ["User is a software engineer", "User prefers dark mode"]. If nothing is worth remembering, return [].';

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
                        lastUser,
                        lastAssistant
                    ]
                })
            });

            if (!response.ok) return;
            const contentType = response.headers.get('content-type') || '';
            let raw = '';

            if (contentType.includes('application/json')) {
                const payload = await response.json();
                raw = payload?.message?.content || payload?.response || '';
            } else {
                raw = await response.text();
            }

            let extracted = [];
            if (raw) {
                try {
                    extracted = JSON.parse(raw);
                } catch {
                    extracted = [];
                }
            }

            if (!Array.isArray(extracted)) return;
            let changed = false;
            for (const item of extracted) {
                if (userMemories.length >= 20) break;
                if (typeof item !== 'string') continue;
                const added = addMemoryText(item);
                if (added) changed = true;
            }

            if (changed && memoryModal?.classList.contains('show')) {
                renderMemoryList();
            }
        } catch {
            // Silent failure
        }
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
    let tagEditor = document.getElementById('tag-editor');
    let tagEditorTags = null;
    let tagEditorInput = null;
    let tagEditorAddBtn = null;

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
            <button class="chat-option-item tag-option" id="global-tag-btn">
                <i class="ph ph-tag"></i> Tag
            </button>
            <button class="chat-option-item delete-option" id="global-delete-btn">
                <i class="ph ph-trash"></i> Delete
            </button>
        `;
        document.body.appendChild(globalDropdown);

        if (!tagEditor) {
            tagEditor = document.createElement('div');
            tagEditor.id = 'tag-editor';
            tagEditor.className = 'tag-editor global-overlay';
            tagEditor.innerHTML = `
                <div class="tag-editor-row" id="tag-editor-tags"></div>
                <div class="tag-editor-input">
                    <input type="text" id="tag-editor-input" maxlength="20" placeholder="Add tag">
                    <button class="tag-editor-add" id="tag-editor-add-btn" title="Add tag">
                        <i class="ph ph-plus"></i>
                    </button>
                </div>
            `;
            document.body.appendChild(tagEditor);
        }
        tagEditorTags = tagEditor.querySelector('#tag-editor-tags');
        tagEditorInput = tagEditor.querySelector('#tag-editor-input');
        tagEditorAddBtn = tagEditor.querySelector('#tag-editor-add-btn');

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

        document.getElementById('global-tag-btn').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!activeDropdownId) return;
            const rect = globalDropdown.getBoundingClientRect();
            openTagEditor(activeDropdownId, rect);
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
            const insideDropdown = e.target.closest('.chat-options-btn') || e.target.closest('#global-chat-options-dropdown');
            const insideTagEditor = e.target.closest('.tag-editor');
            if (!insideDropdown) {
                hideGlobalDropdown();
            }
            if (!insideTagEditor && !insideDropdown) {
                closeTagEditor();
            }
        });
    }

    if (tagEditorTags) {
        tagEditorTags.addEventListener('click', (event) => {
            const removeBtn = event.target.closest('button[data-tag]');
            if (!removeBtn || !tagEditorChatId) return;
            removeTagFromChat(tagEditorChatId, removeBtn.dataset.tag);
        });
    }

    if (tagEditorInput) {
        tagEditorInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitTagEditorInput();
            }
        });
    }

    if (tagEditorAddBtn) {
        tagEditorAddBtn.addEventListener('click', (event) => {
            event.preventDefault();
            submitTagEditorInput();
        });
    }

    function hideGlobalDropdown() {
        globalDropdown.classList.remove('show');
        document.querySelectorAll('.history-item.menu-open').forEach(el => el.classList.remove('menu-open'));
        activeDropdownId = null;
    }

    function closeTagEditor() {
        if (!tagEditor) return;
        tagEditor.classList.remove('show');
        tagEditorChatId = null;
    }

    function renderTagEditor(chatId) {
        if (!tagEditorTags) return;
        const chat = chats.find(c => c.id === chatId);
        const tags = chat ? getChatTags(chat) : [];
        tagEditorTags.innerHTML = '';

        if (!tags.length) {
            const empty = document.createElement('span');
            empty.className = 'tag-editor-empty';
            empty.textContent = 'No tags yet';
            tagEditorTags.appendChild(empty);
            return;
        }

        tags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = `tag-editor-chip tag-color-${getTagColorIndex(tag)}`;
            const label = document.createElement('span');
            label.textContent = tag;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.dataset.tag = tag;
            remove.innerHTML = '&times;';
            remove.title = 'Remove tag';
            chip.appendChild(label);
            chip.appendChild(remove);
            tagEditorTags.appendChild(chip);
        });
    }

    function addTagToChat(chatId, tagValue) {
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;
        const normalized = normalizeTagValue(tagValue);
        if (!normalized) return;

        const tags = getChatTags(chat);
        if (tags.length >= 5) return;
        if (tags.some(tag => tag.toLowerCase() === normalized.toLowerCase())) return;

        chat.tags = [...tags, normalized];
        saveChats();
        renderSidebar();
        renderTagEditor(chatId);
    }

    function removeTagFromChat(chatId, tagValue) {
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;
        const lower = String(tagValue || '').toLowerCase();
        chat.tags = getChatTags(chat).filter(tag => tag.toLowerCase() !== lower);
        saveChats();
        renderSidebar();
        renderTagEditor(chatId);
    }

    function submitTagEditorInput() {
        if (!tagEditorInput || !tagEditorChatId) return;
        const value = tagEditorInput.value;
        addTagToChat(tagEditorChatId, value);
        tagEditorInput.value = '';
    }

    function openTagEditor(chatId, anchorRect) {
        if (!tagEditor) return;
        tagEditorChatId = chatId;
        renderTagEditor(chatId);
        tagEditor.classList.add('show');

        if (anchorRect) {
            const editorRect = tagEditor.getBoundingClientRect();
            let left = anchorRect.left;
            let top = anchorRect.bottom + 6;
            if (left + editorRect.width > window.innerWidth - 8) {
                left = window.innerWidth - editorRect.width - 8;
            }
            if (left < 8) left = 8;
            if (top + editorRect.height > window.innerHeight - 8) {
                top = anchorRect.top - editorRect.height - 6;
            }
            if (top < 8) top = 8;
            tagEditor.style.left = `${left}px`;
            tagEditor.style.top = `${top}px`;
        }

        tagEditorInput?.focus();
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

    function getChatTags(chat) {
        return Array.isArray(chat?.tags) ? chat.tags : [];
    }

    function normalizeTagValue(value) {
        return String(value || '').trim().slice(0, 20);
    }

    function getTagColorIndex(tag) {
        let hash = 0;
        for (let i = 0; i < tag.length; i += 1) {
            hash = ((hash << 5) - hash) + tag.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash) % 6;
    }

    function getAllTags(items) {
        const tagSet = new Set();
        items.forEach(chat => {
            getChatTags(chat).forEach(tag => tagSet.add(tag));
        });
        return Array.from(tagSet);
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
        const allTags = getAllTags(chats);
        if (activeTagFilter && !allTags.includes(activeTagFilter)) {
            activeTagFilter = null;
        }

        const queryFiltered = filterChatsByQuery(chats, sidebarSearchQuery);
        const filteredChats = activeTagFilter
            ? queryFiltered.filter(chat => getChatTags(chat).includes(activeTagFilter))
            : queryFiltered;

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

        const tagBarHtml = allTags.length
            ? `<div class="tag-filter-bar">${allTags.map(tag => {
                const encodedTag = encodeURIComponent(tag);
                const activeClass = activeTagFilter === tag ? ' is-active' : '';
                return `<button class="tag-filter-chip${activeClass}" data-tag="${encodedTag}">${escapeHtml(tag)}</button>`;
            }).join('')}</div>`
            : '';

        sidebarContent.innerHTML = '';
        if (tagBarHtml) {
            sidebarContent.innerHTML += tagBarHtml;
        }

        const shouldShowEmpty = filteredChats.length === 0 && (sidebarSearchQuery || activeTagFilter);
        if (shouldShowEmpty) {
            sidebarContent.innerHTML += `
                <div class="history-empty-state">
                    <span>No results found</span>
                </div>
            `;
            bindTagFilterEvents();
            return;
        }

        function createSection(title, list) {
            if (list.length === 0) return '';
            let html = `<div class="history-section"><h3 class="section-title">${title}</h3><ul class="history-list">`;
            list.forEach(chat => {
                const titleClass = chat.titlePending ? 'history-link-text title-pending' : 'history-link-text';
                const renderedTitle = sidebarSearchQuery ? highlightMatch(chat.title || '', sidebarSearchQuery) : escapeHtml(chat.title || '');
                const chatTags = getChatTags(chat);
                const tagMarkup = chatTags.length
                    ? `<div class="history-tags">${chatTags.map(tag => {
                        const colorIndex = getTagColorIndex(tag);
                        return `<span class="history-tag tag-color-${colorIndex}">${escapeHtml(tag)}</span>`;
                    }).join('')}</div>`
                    : '';
                html += `
                    <li>
                        <a href="#" class="history-item" data-id="${chat.id}">
                            <i class="ph ph-chat-teardrop-text"></i>
                            <div class="history-text">
                                <span class="${titleClass}">${renderedTitle}</span>
                                ${tagMarkup}
                            </div>
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

        bindTagFilterEvents();

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
                    closeTagEditor();
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

    function bindTagFilterEvents() {
        if (!sidebarContent) return;
        sidebarContent.querySelectorAll('.tag-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const encoded = chip.getAttribute('data-tag') || '';
                const tag = decodeURIComponent(encoded);
                if (activeTagFilter === tag) {
                    activeTagFilter = null;
                } else {
                    activeTagFilter = tag;
                }
                renderSidebar();
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
                tags: [],
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

        const memoryBlock = userMemories.length
            ? `You have the following memory about the user:\n${userMemories.map(entry => `- ${entry.text}`).join('\n')}`
            : '';

        if (currentSystemPrompt && currentSystemPrompt.trim()) {
            const systemMessages = [{ role: 'system', content: currentSystemPrompt.trim() }];
            if (memoryBlock) {
                systemMessages.push({ role: 'system', content: memoryBlock });
            }
            return [...systemMessages, ...messages];
        }

        if (memoryBlock) {
            return [{ role: 'system', content: memoryBlock }, ...messages];
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
        const persona = getPersonaById(activePersonaId);
        if (persona && persona.prompt && hasPrompt) {
            systemPromptIndicator.innerHTML = `<i class="ph ${persona.icon}"></i>`;
            systemPromptIndicator.classList.add('has-icon');
        } else {
            systemPromptIndicator.innerHTML = '';
            systemPromptIndicator.classList.remove('has-icon');
        }
    }

    function updateSystemPromptCounter() {
        if (!systemPromptTextarea || !systemPromptCounter) return;
        systemPromptCounter.textContent = `${systemPromptTextarea.value.length} / 2000`;
    }

    function openSystemPromptModal() {
        if (!systemPromptModal || !systemPromptTextarea) return;
        systemPromptTextarea.value = currentSystemPrompt || '';
        updateSystemPromptCounter();
        renderPersonaBar();
        systemPromptModal.classList.add('show');
        systemPromptTextarea.focus();
    }

    function closeSystemPromptModal() {
        if (!systemPromptModal) return;
        systemPromptModal.classList.remove('show');
    }

    // Initialize sidebar
    currentUserProfile = loadUserProfile();
    updateUserProfileUI();
    renderSidebar();
    loadMemories();

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
        systemPromptTextarea.addEventListener('input', () => {
            updateSystemPromptCounter();
            syncPersonaFromTextarea();
        });
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
            activePersonaId = null;
            if (systemPromptTextarea) {
                systemPromptTextarea.value = '';
                updateSystemPromptCounter();
            }
            localStorage.removeItem('qwen_system_prompt');
            renderPersonaBar();
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

    if (personaBar) {
        personaBar.addEventListener('click', (event) => {
            const chip = event.target.closest('.persona-chip');
            if (!chip) return;
            setActivePersona(chip.dataset.id);
        });

        personaBar.addEventListener('wheel', (event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            personaBar.scrollLeft += event.deltaY;
            event.preventDefault();
        }, { passive: false });
    }

    if (memoryBtn) {
        memoryBtn.addEventListener('click', openMemoryModal);
    }

    if (memoryCloseBtn) {
        memoryCloseBtn.addEventListener('click', closeMemoryModal);
    }

    if (memoryModal) {
        memoryModal.addEventListener('click', (event) => {
            if (event.target === memoryModal) {
                closeMemoryModal();
            }
        });
    }

    if (memoryInput) {
        memoryInput.addEventListener('input', updateMemoryCounter);
        memoryInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitMemoryInput();
            }
        });
    }

    if (memoryAddBtn) {
        memoryAddBtn.addEventListener('click', (event) => {
            event.preventDefault();
            submitMemoryInput();
        });
    }

    if (memoryList) {
        memoryList.addEventListener('click', (event) => {
            const removeBtn = event.target.closest('button[data-id]');
            if (!removeBtn) return;
            userMemories = userMemories.filter(entry => entry.id !== removeBtn.dataset.id);
            saveMemories();
            renderMemoryList();
        });
    }

    if (memoryClearBtn) {
        memoryClearBtn.addEventListener('click', () => {
            if (!userMemories.length) return;
            if (!confirm('Clear all memories?')) return;
            userMemories = [];
            saveMemories();
            renderMemoryList();
            updateMemoryCounter();
        });
    }

    if (userProfileBtn) {
        userProfileBtn.addEventListener('click', () => {
            const nextName = prompt('Enter your name for memory personalization:', currentUserProfile?.name || 'User');
            if (!nextName) return;
            const trimmed = nextName.trim().slice(0, 40);
            if (!trimmed) return;
            currentUserProfile = {
                id: slugifyUserId(trimmed),
                name: trimmed
            };
            saveUserProfile(currentUserProfile);
            updateUserProfileUI();
            loadMemories();
            if (memoryModal?.classList.contains('show')) {
                renderMemoryList();
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
            extractMemoryFromLastTurn();
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
        if (memoryModal) memoryModal.classList.remove('show');
        if (shortcutsModal) shortcutsModal.classList.remove('show');
        if (modelSelector) modelSelector.classList.remove('open');
        hideGlobalDropdown();
        closeTagEditor();
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

        if (event.ctrlKey && event.shiftKey && key.toLowerCase() === 'm') {
            event.preventDefault();
            openMemoryModal();
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

