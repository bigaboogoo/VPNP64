class VPNP64 {
    constructor() {
        this.initElements();
        this.attachEventListeners();
        this.loadStats();
        this.loadCachedPages();
        
        // Refresh stats every 5 seconds
        setInterval(() => this.loadStats(), 5000);
    }

    initElements() {
        this.urlInput = document.getElementById('urlInput');
        this.fetchBtn = document.getElementById('fetchBtn');
        this.loading = document.getElementById('loading');
        this.message = document.getElementById('message');
        this.proxyFrame = document.getElementById('proxyFrame');
        this.contentFrame = document.getElementById('contentFrame');
        this.frameUrl = document.getElementById('frameUrl');
        this.frameStatus = document.getElementById('frameStatus');
        this.closeFrameBtn = document.getElementById('closeFrameBtn');
        this.refreshCacheBtn = document.getElementById('refreshCacheBtn');
        this.clearCacheBtn = document.getElementById('clearCacheBtn');
        this.cacheList = document.getElementById('cacheList');
        this.enableCache = document.getElementById('enableCache');
    }

    attachEventListeners() {
        this.fetchBtn.addEventListener('click', () => this.fetchUrl());
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.fetchUrl();
        });
        this.closeFrameBtn.addEventListener('click', () => this.closeFrame());
        this.refreshCacheBtn.addEventListener('click', () => this.loadCachedPages());
        this.clearCacheBtn.addEventListener('click', () => this.clearCache());
    }

    async fetchUrl() {
        const urlValue = this.urlInput.value.trim();
        
        if (!urlValue) {
            this.showMessage('Please enter a URL', 'error');
            return;
        }

        // Add protocol if missing
        let url = urlValue;
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        this.showLoading(true);
        this.hideMessage();

        try {
            const response = await fetch(`/proxy?url=${encodeURIComponent(url)}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const cacheStatus = response.headers.get('X-Proxy-Cache');
            const originalUrl = response.headers.get('X-Proxy-Original-Url');

            this.frameUrl.textContent = originalUrl;
            this.frameStatus.textContent = `Cache: ${cacheStatus}`;
            this.frameStatus.style.background = cacheStatus === 'HIT' ? '#00d084' : '#6c63ff';

            // Display HTML content
            const html = await response.text();
            this.showProxyContent(html);
            this.loadCachedPages();
            this.loadStats();

        } catch (error) {
            this.showMessage(`Failed to fetch: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    showProxyContent(html) {
        this.proxyFrame.classList.remove('hidden');
        this.contentFrame.srcdoc = html;
    }

    closeFrame() {
        this.proxyFrame.classList.add('hidden');
        this.contentFrame.srcdoc = '';
    }

    async loadStats() {
        try {
            const response = await fetch('/api/stats');
            const stats = await response.json();

            document.getElementById('statHits').textContent = stats.hits;
            document.getElementById('statMisses').textContent = stats.misses;
            document.getElementById('statHitRate').textContent = stats.hitRate;
            document.getElementById('statCached').textContent = stats.cacheKeys;

        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    async loadCachedPages() {
        try {
            const response = await fetch('/api/cache/list');
            const data = await response.json();

            this.cacheList.innerHTML = '';

            if (data.mostRecent.length === 0) {
                this.cacheList.innerHTML = '<p style="text-align: center; color: #a8adb5;">No cached pages yet</p>';
                return;
            }

            data.mostRecent.forEach(item => {
                const cacheItem = document.createElement('div');
                cacheItem.className = 'cache-item';
                cacheItem.innerHTML = `
                    <div class="cache-item-info">
                        <div class="cache-item-url">${this.truncateUrl(item.url)}</div>
                        <div class="cache-item-meta">
                            Size: ${this.formatBytes(item.size)} • Cached: ${new Date(item.timestamp).toLocaleString()}
                        </div>
                    </div>
                    <div class="cache-item-actions">
                        <button class="btn btn-small" onclick="app.loadCachedUrl('${item.url}')">Load</button>
                    </div>
                `;
                this.cacheList.appendChild(cacheItem);
            });

        } catch (error) {
            console.error('Failed to load cached pages:', error);
        }
    }

    async loadCachedUrl(url) {
        this.urlInput.value = url;
        await this.fetchUrl();
    }

    async clearCache() {
        if (!confirm('Are you sure you want to clear all cached pages?')) return;

        try {
            const response = await fetch('/api/cache/clear', { method: 'POST' });
            const result = await response.json();
            
            this.showMessage('Cache cleared successfully', 'success');
            this.loadCachedPages();
            this.loadStats();

        } catch (error) {
            this.showMessage(`Failed to clear cache: ${error.message}`, 'error');
        }
    }

    showLoading(show) {
        this.loading.classList.toggle('hidden', !show);
    }

    showMessage(text, type = 'info') {
        this.message.textContent = text;
        this.message.className = `message ${type}`;
        this.message.style.borderLeftColor = type === 'error' ? '#ff6b6b' : 
                                             type === 'success' ? '#00d084' : '#6c63ff';
    }

    hideMessage() {
        this.message.classList.add('hidden');
    }

    truncateUrl(url) {
        return url.length > 60 ? url.substring(0, 60) + '...' : url;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VPNP64();
});
