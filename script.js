'use strict';

class GalleryDB {
    constructor(dbName, dbVersion, storeName) {
        this.dbName = dbName;
        this.dbVersion = dbVersion;
        this.storeName = storeName;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
        });
    }

    async saveGallery(gallery) {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const galleryData = {
            id: gallery.id,
            name: gallery.name,
            directoryHandle: gallery.directoryHandle,
            isShuffled: gallery.isShuffled
            ,
            order: gallery.order
        };
        await store.put(galleryData);
    }

    async loadGalleries() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteGallery(id) {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        await store.delete(id);
    }
}

class GalleryManager {
    constructor(db) {
        this.db = db;
        this.galleries = [];
        this.activeGalleryIndex = -1;
    }

    async loadFromStorage() {
        try {
            const storedGalleries = await this.db.loadGalleries();

            if (storedGalleries.length > 0) {
                this.showLoading(true);
            }

            // sort stored galleries by saved order (if present)
            storedGalleries.sort((a, b) => (a.order || 0) - (b.order || 0));

            for (const storedGallery of storedGalleries) {
                const hasPermission = await this.verifyPermission(storedGallery.directoryHandle);

                if (hasPermission) {
                    const gallery = new Gallery(storedGallery.id, storedGallery.name, storedGallery.directoryHandle);
                    gallery.isShuffled = storedGallery.isShuffled || false;
                    gallery.order = storedGallery.order || 0;
                    await gallery.loadMedia();
                    this.galleries.push(gallery);
                    this.addGalleryTab(gallery, this.galleries.length - 1);
                } else {
                    console.warn(`Permission denied for gallery: ${storedGallery.name}`);
                }
            }

            if (this.galleries.length > 0) {
                this.selectGallery(0);
            }

            this.showLoading(false);
        } catch (err) {
            console.error('Error loading galleries from storage:', err);
            this.showLoading(false);
        }
    }

    async createGallery(name, directoryHandle) {
        this.showLoading(true);

        const gallery = new Gallery(Date.now(), name, directoryHandle);
        // set order to end of list
        gallery.order = this.galleries.length;
        await gallery.loadMedia();

        await this.db.saveGallery(gallery);

        this.galleries.push(gallery);
        this.addGalleryTab(gallery, this.galleries.length - 1);
        this.selectGallery(this.galleries.length - 1);

        this.showLoading(false);
    }

    async closeGallery(event, index) {
        event.stopPropagation();

        const gallery = this.galleries[index];
        gallery.media.forEach(media => {
            URL.revokeObjectURL(media.url);
        });

        await this.db.deleteGallery(gallery.id);

        this.galleries.splice(index, 1);

        if (this.galleries.length > 0) {
            if (index < this.activeGalleryIndex) {
                this.activeGalleryIndex--;
            } else if (index === this.activeGalleryIndex) {
                this.activeGalleryIndex = Math.min(index, this.galleries.length - 1);
            }

            this.rebuildTabs();
            this.selectGallery(this.activeGalleryIndex);
        } else {
            this.activeGalleryIndex = -1;
            document.querySelectorAll('.tab').forEach(tab => tab.remove());
            document.getElementById('emptyState').style.display = 'flex';
            document.getElementById('mediaContainer').style.display = 'none';
            document.getElementById('randomButton').style.display = 'none';
            document.getElementById('thumbnailGrid').innerHTML = '';
        }
    }

    selectGallery(index) {
        if (index < 0 || index >= this.galleries.length) return;

        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`.tab[data-index="${index}"]`).classList.add('active');

        this.activeGalleryIndex = index;
        this.activeMediaIndex = 0;
        this.isRandomMode = false;
        this.previousMediaIndex = -1;

        const gallery = this.galleries[index];
        if (gallery.media.length > 0) {
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('mediaContainer').style.display = 'flex';
            document.getElementById('randomButton').style.display = 'flex';

            // Restore shuffle button state
            const shuffleButton = document.getElementById('shuffleButton');
            if (gallery.isShuffled) {
                shuffleButton.classList.add('active');
                shuffleButton.setAttribute('title', 'Unshuffle Gallery');
            } else {
                shuffleButton.classList.remove('active');
                shuffleButton.setAttribute('title', 'Shuffle Gallery');
            }

            this.displayThumbnails(gallery);
            this.displayMedia(0);
        } else {
            document.getElementById('emptyState').style.display = 'flex';
            document.getElementById('mediaContainer').style.display = 'none';
            document.getElementById('randomButton').style.display = 'none';
        }
    }

    displayMedia(index, isRandom) {
        const gallery = this.galleries[this.activeGalleryIndex];
        if (!gallery || index < 0 || index >= gallery.media.length) return;

        this.activeMediaIndex = index;
        const media = gallery.media[index];

        document.querySelectorAll('.thumbnail').forEach((thumb, i) => {
            thumb.classList.toggle('active', i === index);
        });

        this.resetTransform();

        const imgPreview = document.getElementById('mediaPreview');
        const videoPreview = document.getElementById('videoPreview');
        const videoControls = document.getElementById('videoControls');
        const fileInfo = document.getElementById('fileInfo');

        fileInfo.innerText = media.name;
        fileInfo.onclick = () => {
            window.open(media.url, '_blank');
        };

        if (media.type === 'image') {
            imgPreview.src = media.url;
            imgPreview.style.display = 'block';
            videoPreview.style.display = 'none';
            videoControls.style.display = 'none';
            videoPreview.pause();
        } else {
            videoPreview.src = media.url;
            videoPreview.style.display = 'block';
            imgPreview.style.display = 'none';
            videoControls.style.display = 'block';
            videoPreview.play();
        }
        if (!isRandom) {
            const activeThumbnail = document.querySelector('.thumbnail.active');
            if (activeThumbnail) {
                activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    displayThumbnails(gallery) {
        const grid = document.getElementById('thumbnailGrid');
        grid.innerHTML = '';

        gallery.media.forEach((media, index) => {
            const thumbnail = document.createElement('div');
            thumbnail.className = 'thumbnail';
            thumbnail.title = media.path;
            if (index === 0) thumbnail.classList.add('active');

            if (media.type === 'image') {
                thumbnail.innerHTML = `<img src="${media.url}" alt="${media.name}">`;
            } else {
                const videoEl = document.createElement('video');
                videoEl.src = media.url;
                videoEl.muted = true;
                videoEl.preload = 'metadata';

                const indicator = document.createElement('div');
                indicator.className = 'video-indicator';
                indicator.textContent = '▶';

                thumbnail.appendChild(videoEl);
                thumbnail.appendChild(indicator);

            }

            thumbnail.onclick = () => {
                this.isRandomMode = false;
                this.displayMedia(index);
            };

            grid.appendChild(thumbnail);
        });
    }

    addGalleryTab(gallery, index) {
        const tabBar = document.getElementById('tabBar');
        const addButton = tabBar.querySelector('.add-tab');

        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.dataset.index = index;
        tab.draggable = true;
        tab.innerHTML = `
            <span class="tab-name">${gallery.name}</span>
            <span class="tab-close" onclick="app.galleryManager.closeGallery(event, ${index})">×</span>
        `;

        tab.onclick = (e) => {
            if (!e.target.classList.contains('tab-close')) {
                this.selectGallery(index);
            }
        };

        tab.addEventListener('dragstart', this.handleTabDragStart.bind(this));
        tab.addEventListener('dragend', this.handleTabDragEnd.bind(this));
        tab.addEventListener('dragover', this.handleTabDragOver.bind(this));
        tab.addEventListener('dragenter', this.handleTabDragEnter.bind(this));
        tab.addEventListener('dragleave', this.handleTabDragLeave.bind(this));
        tab.addEventListener('drop', this.handleTabDrop.bind(this));

        tabBar.insertBefore(tab, addButton);
    }

    rebuildTabs() {
        const tabBar = document.getElementById('tabBar');
        const addButton = tabBar.querySelector('.add-tab');

        document.querySelectorAll('.tab').forEach(tab => tab.remove());

        this.galleries.forEach((gallery, index) => {
            const tab = document.createElement('div');
            tab.className = 'tab';
            if (index === this.activeGalleryIndex) {
                tab.classList.add('active');
            }
            tab.dataset.index = index;
            tab.draggable = true;
            tab.innerHTML = `
                <span class="tab-name">${gallery.name}</span>
                <span class="tab-close" onclick="app.galleryManager.closeGallery(event, ${index})">×</span>
            `;

            tab.onclick = (e) => {
                if (!e.target.classList.contains('tab-close')) {
                    this.selectGallery(index);
                }
            };

            tab.addEventListener('dragstart', this.handleTabDragStart.bind(this));
            tab.addEventListener('dragend', this.handleTabDragEnd.bind(this));
            tab.addEventListener('dragover', this.handleTabDragOver.bind(this));
            tab.addEventListener('dragenter', this.handleTabDragEnter.bind(this));
            tab.addEventListener('dragleave', this.handleTabDragLeave.bind(this));
            tab.addEventListener('drop', this.handleTabDrop.bind(this));

            tabBar.insertBefore(tab, addButton);
        });
    }

    handleTabDragStart(e) {
        const tab = e.target;
        const index = parseInt(tab.dataset.index);

        tab.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', tab.innerHTML);

        this.draggedTabElement = tab;
        this.draggedTabIndex = index;
    }

    handleTabDragEnd(e) {
        e.target.classList.remove('dragging');

        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('drag-over');
        });

        this.draggedTabElement = null;
        this.draggedTabIndex = -1;
    }

    handleTabDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    handleTabDragEnter(e) {
        if (e.target !== this.draggedTabElement && e.target.classList.contains('tab')) {
            e.target.classList.add('drag-over');
        }
    }

    handleTabDragLeave(e) {
        e.target.classList.remove('drag-over');
    }

    async handleTabDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }

        const targetTab = e.target;
        const targetIndex = parseInt(targetTab.dataset.index);

        if (this.draggedTabElement !== targetTab && this.draggedTabIndex !== targetIndex) {
            const movedGallery = this.galleries[this.draggedTabIndex];
            this.galleries.splice(this.draggedTabIndex, 1);
            this.galleries.splice(targetIndex, 0, movedGallery);

            if (this.activeGalleryIndex === this.draggedTabIndex) {
                this.activeGalleryIndex = targetIndex;
            } else if (this.draggedTabIndex < this.activeGalleryIndex && targetIndex >= this.activeGalleryIndex) {
                this.activeGalleryIndex--;
            } else if (this.draggedTabIndex > this.activeGalleryIndex && targetIndex <= this.activeGalleryIndex) {
                this.activeGalleryIndex++;
            }

            // update order values and persist to DB
            this.galleries.forEach((g, idx) => {
                g.order = idx;
            });

            try {
                // save all galleries order to DB
                for (const g of this.galleries) {
                    await this.db.saveGallery(g);
                }
            } catch (err) {
                console.error('Error saving gallery order:', err);
            }

            this.rebuildTabs();
        }

        return false;
    }

    async verifyPermission(directoryHandle, withWrite = true) {
        const opts = {};
        if (withWrite) {
            opts.mode = 'readwrite';
        }

        if ((await directoryHandle.queryPermission(opts)) === 'granted') {
            return true;
        }

        if ((await directoryHandle.requestPermission(opts)) === 'granted') {
            return true;
        }

        return false;
    }

    showLoading(show = true) {
        document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
    }

    resetTransform() {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.applyTransform();
    }

    applyTransform() {
        const videoPreview = document.getElementById('videoPreview');
        const mediaPreview = document.getElementById('mediaPreview');
        let element = 0;
        if (videoPreview.style.display !== 'none') {
            element = videoPreview;
        } else {
            element = mediaPreview;
        }
        element.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    }
}

class Gallery {
    constructor(id, name, directoryHandle) {
        this.id = id;
        this.name = name;
        this.directoryHandle = directoryHandle;
        this.media = [];
        this.isShuffled = false;
    }

    async loadMedia() {
        this.media = [];

        try {
            const hasPermission = await this.verifyPermission(this.directoryHandle);
            if (!hasPermission) {
                console.warn('Permission denied for', this.name);
                alert(`Permission denied for "${this.name}".`);
                return;
            }

            const fileEntries = await this.scanDirectoryRecursive(this.directoryHandle);

            for (const fileEntry of fileEntries) {
                try {
                    const file = await fileEntry.entry.getFile();
                    const url = URL.createObjectURL(file);
                    this.media.push({
                        name: fileEntry.entry.name,
                        path: fileEntry.path,
                        url: url,
                        type: fileEntry.type,
                        file: file,
                        lastModified: file.lastModified
                    });
                } catch (err) {
                    console.error('Error loading file:', fileEntry.path, err);
                }
            }

            this.media.sort((a, b) => b.lastModified - a.lastModified);

            // If gallery is in shuffle mode, shuffle the media after loading
            if (this.isShuffled) {
                for (let i = this.media.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [this.media[i], this.media[j]] = [this.media[j], this.media[i]];
                }
            }

            console.log(`Loaded ${this.media.length} media files from "${this.name}" (including subdirectories)`);
        } catch (err) {
            console.error('Error loading media:', err);
            alert(`Could not load media from "${this.name}". Permission may have been revoked.`);
        }
    }

    async scanDirectoryRecursive(dirHandle, path = '') {
        const files = [];
        const supportedFormats = {
            image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
            video: ['.mp4', '.webm', '.ogg']
        };

        try {
            for await (const entry of dirHandle.values()) {
                const entryPath = path ? `${path}/${entry.name}` : entry.name;

                if (entry.kind === 'file') {
                    const extension = '.' + entry.name.split('.').pop().toLowerCase();
                    const isImage = supportedFormats.image.includes(extension);
                    const isVideo = supportedFormats.video.includes(extension);

                    if (isImage || isVideo) {
                        files.push({
                            entry: entry,
                            path: entryPath,
                            type: isImage ? 'image' : 'video'
                        });
                    }
                } else if (entry.kind === 'directory') {
                    const subFiles = await this.scanDirectoryRecursive(entry, entryPath);
                    files.push(...subFiles);
                }
            }
        } catch (err) {
            console.error('Error scanning directory:', err);
        }

        return files;
    }

    async verifyPermission(directoryHandle, withWrite = true) {
        const opts = {};
        if (withWrite) {
            opts.mode = 'readwrite';
        }

        if ((await directoryHandle.queryPermission(opts)) === 'granted') {
            return true;
        }

        if ((await directoryHandle.requestPermission(opts)) === 'granted') {
            return true;
        }

        return false;
    }
}

class App {
    constructor() {
        this.db = new GalleryDB('GalleryViewerDB', 1, 'galleries');
        this.galleryManager = new GalleryManager(this.db);
        this.setupEventListeners();
    }

    async init() {
        await this.db.init();
        await this.galleryManager.loadFromStorage();
    }

    setupEventListeners() {
        const previewSection = document.getElementById('previewSection');
        const mediaPreview = document.getElementById('mediaPreview');
        const videoPreview = document.getElementById('videoPreview');
        const progressBar = document.getElementById('progressBar');

        previewSection.addEventListener('contextmenu', e => e.preventDefault());
        previewSection.addEventListener('mousedown', this.handleMouseDown.bind(this));
        previewSection.addEventListener('wheel', this.handleWheel.bind(this));
        // allow dragging files/links into the preview area and show visual feedback
        previewSection.addEventListener('dragover', e => e.preventDefault());
        previewSection.addEventListener('dragenter', this.handleDragEnter.bind(this));
        previewSection.addEventListener('dragleave', this.handleDragLeave.bind(this));
        previewSection.addEventListener('drop', this.handleDrop.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));

        progressBar.addEventListener('click', this.seekVideo.bind(this));
        videoPreview.addEventListener('timeupdate', this.updateProgress.bind(this));
        videoPreview.addEventListener('click', this.togglePlayPause.bind(this));

        document.addEventListener('keydown', this.handleKeyboard.bind(this));

        // handle paste events (images/videos from clipboard)
        document.addEventListener('paste', this.handlePaste.bind(this));

        document.querySelector('.add-tab').addEventListener('click', this.showNewGalleryModal.bind(this));
        document.querySelector('.browse-button').addEventListener('click', this.showNewGalleryModal.bind(this));
        document.querySelector('.modal-button.primary').addEventListener('click', this.createGallery.bind(this));
        document.querySelector('.modal-button.close').addEventListener('click', this.closeModal.bind(this));
        document.querySelector('.modal-button.browse-folder').addEventListener('click', this.selectFolder.bind(this));
        document.querySelector('#randomButton').addEventListener('click', this.toggleRandomMedia.bind(this));
        document.getElementById('infoButton').addEventListener('click', this.showInfoModal.bind(this));
        document.getElementById('shuffleButton').addEventListener('click', this.shuffleGallery.bind(this));
        document.querySelector('.info-close').addEventListener('click', this.closeInfoModal.bind(this));
    }
    delta = 0;
    handleWheel(e) {
        let now = Date.now();
        if (now - this.delta < 100) return;
        this.delta = now;
        e.preventDefault();
        const mediaPreview = document.getElementById('mediaPreview');
        const videoPreview = document.getElementById('videoPreview');
        const activeMedia = mediaPreview.style.display !== 'none' ? mediaPreview : videoPreview;

        const rect = activeMedia.getBoundingClientRect();
        const isOverMedia = e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom;

        if (isOverMedia) {
            if (videoPreview.style.display !== 'none') {
                const delta = e.deltaY > 0 ? -1 : 1;
                videoPreview.currentTime = Math.max(0, Math.min(videoPreview.duration, videoPreview.currentTime + delta));
            } else {
                this.navigateMedia(e.deltaY > 0 ? 1 : -1);
            }
        } else {
            this.navigateMedia(e.deltaY > 0 ? 1 : -1);
        }
    }

    navigateMedia(direction) {
        const gallery = this.galleryManager.galleries[this.galleryManager.activeGalleryIndex];
        if (!gallery || gallery.media.length === 0) return;

        if (this.galleryManager.isRandomMode) {
            if (direction === -1) {
                if (this.galleryManager.previousMediaIndex !== -1 && this.galleryManager.previousMediaIndex !== this.galleryManager.activeMediaIndex) {
                    const tempPrevious = this.galleryManager.previousMediaIndex;
                    this.galleryManager.previousMediaIndex = -1;
                    this.galleryManager.displayMedia(tempPrevious);
                } else {
                    this.selectRandomMedia();
                }
            } else {
                this.selectRandomMedia();
            }
        } else {
            let newIndex = this.galleryManager.activeMediaIndex + direction;
            if (newIndex < 0) newIndex = gallery.media.length - 1;
            if (newIndex >= gallery.media.length) newIndex = 0;
            this.galleryManager.displayMedia(newIndex);
        }
    }
    async shuffleGallery() {
        const gallery = this.galleryManager.galleries[this.galleryManager.activeGalleryIndex];
        if (!gallery || gallery.media.length === 0) return;

        // Toggle shuffle state
        gallery.isShuffled = !gallery.isShuffled;

        // Update visual feedback
        const shuffleButton = document.getElementById('shuffleButton');
        if (gallery.isShuffled) {
            shuffleButton.classList.add('active');
            // Shuffle the media array
            for (let i = gallery.media.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [gallery.media[i], gallery.media[j]] = [gallery.media[j], gallery.media[i]];
            }
        } else {
            shuffleButton.classList.remove('active');
            // Restore original sort order (by lastModified)
            gallery.media.sort((a, b) => b.lastModified - a.lastModified);
        }

        // Save the updated gallery state to database
        await this.db.saveGallery(gallery);

        this.galleryManager.displayThumbnails(gallery);
        this.galleryManager.displayMedia(0);
    }

    toggleRandomMedia() {
        this.galleryManager.isRandomMode = !this.galleryManager.isRandomMode;
        const randomButton = document.getElementById('randomButton');
        if (this.galleryManager.isRandomMode) {
            randomButton.classList.add('active');
            this.selectRandomMedia();
        } else {
            randomButton.classList.remove('active');
        }
    }

    selectRandomMedia() {
        const gallery = this.galleryManager.galleries[this.galleryManager.activeGalleryIndex];
        if (!gallery || gallery.media.length <= 1) return;

        this.galleryManager.isRandomMode = true;

        this.galleryManager.previousMediaIndex = this.galleryManager.activeMediaIndex;

        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * gallery.media.length);
        } while (randomIndex === this.galleryManager.activeMediaIndex);

        this.galleryManager.displayMedia(randomIndex, true);
    }

    handleMouseDown(e) {
        if (e.button === 0) {
            this.isDragging = true;
            this.startX = e.clientX - this.galleryManager.translateX;
            this.startY = e.clientY - this.galleryManager.translateY;
            e.target.style.cursor = 'grabbing';
        } else if (e.button === 2) {
            this.isRightMouseDown = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            e.preventDefault();
        }
    }

    handleMouseMove(e) {
        if (this.isDragging) {
            let now = Date.now();
            if (now - this.delta < 100) return;
            this.delta = now;
            this.galleryManager.translateX = e.clientX - this.startX;
            this.galleryManager.translateY = e.clientY - this.startY;
            this.galleryManager.applyTransform();
        } else if (this.isRightMouseDown) {

            const deltaY = e.clientY - this.lastMouseY;
            this.galleryManager.scale -= deltaY / 100;
            this.galleryManager.scale = Math.min(Math.max(this.galleryManager.scale, 0.5), 5);
            this.galleryManager.applyTransform();


            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        }
    }

    handleMouseUp(e) {
        if (e.button === 0) {
            this.isDragging = false;
            const mediaPreview = document.getElementById('mediaPreview');
            mediaPreview.style.cursor = 'move';
        } else if (e.button === 2) {
            this.isRightMouseDown = false;
        }
    }

    handleKeyboard(e) {
        if (document.querySelector('#newGalleryModal.active')) return;
        if (this.galleryManager.activeGalleryIndex === -1) return;

        switch (e.key) {
            case 'ArrowRight':
                this.navigateMedia(1);
                break;
            case 'ArrowLeft':
                this.navigateMedia(-1);
                break;
            case 'r':
                this.selectRandomMedia();
                break;
            case ' ':
                e.preventDefault();
                const video = document.getElementById('videoPreview');
                if (video.style.display !== 'none') {
                    this.togglePlayPause();
                }
                break;
        }
    }

    async selectFolder() {
        try {
            this.selectedDirectoryHandle = await window.showDirectoryPicker();
            document.getElementById('selectedPath').textContent = this.selectedDirectoryHandle.name;
        } catch (err) {
            console.error('Folder selection cancelled or failed:', err);
        }
    }

    showNewGalleryModal() {
        document.getElementById('newGalleryModal').classList.add('active');
        document.getElementById('galleryName').value = '';
        document.getElementById('selectedPath').textContent = '';
        this.selectedDirectoryHandle = null;
    }

    closeModal() {
        document.getElementById('newGalleryModal').classList.remove('active');
    }

    showInfoModal() {
        document.getElementById('infoModal').classList.add('active');
    }

    closeInfoModal() {
        document.getElementById('infoModal').classList.remove('active');
    }

    async createGallery() {
        const name = document.getElementById('galleryName').value;
        if (!name || !this.selectedDirectoryHandle) {
            alert('Please enter a name and select a folder');
            return;
        }

        this.closeModal();
        await this.galleryManager.createGallery(name, this.selectedDirectoryHandle);
    }

    togglePlayPause(e) {
        const video = document.getElementById('videoPreview');
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }

    updateProgress() {
        const video = document.getElementById('videoPreview');
        const progressFill = document.getElementById('progressFill');
        const progress = (video.currentTime / video.duration) * 100;
        progressFill.style.width = progress + '%';
    }

    seekVideo(e) {
        const video = document.getElementById('videoPreview');
        const progressBar = document.getElementById('progressBar');
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        video.currentTime = percent * video.duration;
    }

    // Handle files dropped into the preview area
    async handleDrop(e) {
        e.preventDefault();
        // reset drag visual state
        this.dragCounter = 0;
        const preview = document.getElementById('previewSection');
        preview.classList.remove('drop-target');

        const dt = e.dataTransfer;
        // 1) Save any files that were dropped
        const files = Array.from(dt.files || []);
        for (const file of files) {
            try {
                await this.saveFileToActiveGallery(file);
            } catch (err) {
                console.error('Failed to save dropped file:', err);
                alert('Failed to save file: ' + (file.name || 'unknown'));
            }
        }

        // Refresh gallery view if anything was saved
        const gallery = this.galleryManager.galleries[this.galleryManager.activeGalleryIndex];
        if (gallery) {
            await gallery.loadMedia();
            this.galleryManager.displayThumbnails(gallery);
            this.galleryManager.displayMedia(0);
        }
    }

    handleDragEnter(e) {
        e.preventDefault();
        this.dragCounter = (this.dragCounter || 0) + 1;
        const preview = document.getElementById('previewSection');
        preview.classList.add('drop-target');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.dragCounter = (this.dragCounter || 0) - 1;
        if (this.dragCounter <= 0) {
            this.dragCounter = 0;
            const preview = document.getElementById('previewSection');
            preview.classList.remove('drop-target');
        }
    }

    // Fetch a URL and save it into the active gallery (if it's an image/video)


    // Handle paste (clipboard) events
    async handlePaste(e) {
        if (!e.clipboardData) return;

        const items = Array.from(e.clipboardData.items || []);
        const files = [];

        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        }

        if (files.length === 0) return;

        for (const file of files) {
            try {
                await this.saveFileToActiveGallery(file);
            } catch (err) {
                console.error('Failed to save pasted file:', err);
                alert('Failed to save pasted file');
            }
        }

        const gallery = this.galleryManager.galleries[this.galleryManager.activeGalleryIndex];
        if (gallery) {
            await gallery.loadMedia();
            this.galleryManager.displayThumbnails(gallery);
            this.galleryManager.displayMedia(0);
        }
    }

    // Save a File object into the active gallery directory with a generated name
    async saveFileToActiveGallery(file) {
        const gallery = this.galleryManager.galleries[this.galleryManager.activeGalleryIndex];
        if (!gallery) throw new Error('No active gallery selected');

        // Ensure we have write permission
        const hasPerm = await gallery.verifyPermission(gallery.directoryHandle, true);
        if (!hasPerm) throw new Error('Write permission denied for gallery directory');

        const ext = this.getExtensionFromFileName(file.name) || this.getExtensionFromMime(file.type) || 'bin';
        const prefix = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${prefix}${timestamp}.${ext}`;

        try {
            const handle = await gallery.directoryHandle.getFileHandle(filename, { create: true });
            const writable = await handle.createWritable();
            // If file is a Blob/File, write it directly
            await writable.write(file);
            await writable.close();
        } catch (err) {
            console.error('Error writing file to directory:', err);
            throw err;
        }
    }

    getExtensionFromFileName(name) {
        if (!name || name.indexOf('.') === -1) return null;
        return name.split('.').pop().toLowerCase();
    }

    getExtensionFromMime(mime) {
        if (!mime || !mime.includes('/')) return null;
        const subtype = mime.split('/')[1].split('+')[0];
        // map common types
        const map = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', mp4: 'mp4', webm: 'webm', 'x-matroska': 'mkv', quicktime: 'mov' };
        return map[subtype] || subtype;
    }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
