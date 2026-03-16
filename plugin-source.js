import { Plugin, ItemView, Notice, Modal, Setting, PluginSettingTab, setIcon } from 'obsidian';
import * as fs from 'fs';
import * as nodePath from 'path';
import * as PDFLib from 'pdf-lib';
// Explicitly extract what we need from PDFLib if needed, but keeping the PDFLib name for compatibility with existing code replacements

// ── Default Settings ────────────────────────────────────────
const DEFAULT_SETTINGS = {
    backupMode: 'beside',
    backupFolder: '',
    eraserMode: 'stroke',
    eraserSize: 20,
    newPdfFolder: '',
    allowTouch: true,
    penSideButtonTool: 'eraser',
    enabledTools: ['nav', 'zoom', 'scroll', 'select', 'lasso', 'pen', 'eraser', 'text', 'image', 'snip', 'paste', 'delete', 'rect', 'circle', 'line', 'arrow', 'undo', 'zen', 'insert', 'remove', 'save', 'flatten'],
    textFont: 'Inter',
    textSize: 16,
    iconType: 'lucide',
    toolbarPosition: 'top',
    toolIcons: {
        prev: '◀', next: '▶',
        zoomOut: '➖', zoomIn: '➕',
        scroll: '✋', select: '🖱️', lasso: '◌',
        pen: '✏️', eraser: '⬛', text: 'T',
        image: '🖼️', snip: '✂️', paste: '📋', delete: '❌',
        rect: '▭', circle: '○', line: '╱', arrow: '→',
        undo: '↩', zen: '⛶', insert: '📄', remove: '🗑️',
        save: '💾', flatten: '🔥'
    }
};


const LUCIDE_ICONS = {
    scroll: 'hand', select: 'mouse-pointer-2', lasso: 'lasso', pen: 'pen-tool',
    eraser: 'eraser', text: 'type', image: 'image', snip: 'scissors',
    paste: 'clipboard-paste', delete: 'trash-2',
    rect: 'square', circle: 'circle', line: 'minus', arrow: 'arrow-up-right',
    prev: 'chevron-left', next: 'chevron-right', zoomOut: 'minus-circle', zoomIn: 'plus-circle',
    undo: 'undo-2', insert: 'file-plus', remove: 'file-minus', zen: 'maximize',
    save: 'save', flatten: 'flame'
};




const VIEW_TYPE = 'pdf-notes-view';
const PAGE_TYPES = [
    { id: 'blank', label: '⬜ Blank' },
    { id: 'lined', label: '≡ Lined' },
    { id: 'grid', label: '⊞ Grid' },
    { id: 'dotted', label: '⠿ Dotted' },
    { id: 'cornell', label: '📋 Cornell' },
];

// ── pdf-lib ──────────────────────────────────────────────────────
// pdf-lib is now bundled via imports

function hexRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1], 16) / 255, g: parseInt(r[2], 16) / 255, b: parseInt(r[3], 16) / 255 } : { r: 0, g: 0, b: 0 };
}

// Interpolate points along quadratic splines for smoother PDF Ink annotations
function smoothPoints(rawPts, factor = 10) {
    if (!rawPts || rawPts.length < 3) return rawPts;
    const out = [rawPts[0]];
    for (let i = 1; i < rawPts.length - 1; i++) {
        const p0 = rawPts[i - 1], p1 = rawPts[i], p2 = rawPts[i + 1];
        const startX = (i === 1) ? p0.x : (p0.x + p1.x) / 2;
        const startY = (i === 1) ? p0.y : (p0.y + p1.y) / 2;
        const endX = (i === rawPts.length - 2) ? p2.x : (p1.x + p2.x) / 2;
        const endY = (i === rawPts.length - 2) ? p2.y : (p1.y + p2.y) / 2;
        
        for (let t = 1; t <= factor; t++) {
            const f = t / factor;
            const x = (1 - f) * (1 - f) * startX + 2 * (1 - f) * f * p1.x + f * f * endX;
            const y = (1 - f) * (1 - f) * startY + 2 * (1 - f) * f * p1.y + f * f * endY;
            out.push({ x, y });
        }
    }
    const last = rawPts[rawPts.length - 1];
    if (Math.hypot(last.x - out[out.length - 1].x, last.y - out[out.length - 1].y) > 0.1) out.push(last);
    return out;
}


function getBounds(pts) {
    if (!pts || pts.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
}


function drawPattern(page, type, lib) {
    const { rgb } = lib;
    const { width: W, height: H } = page.getSize();
    const lc = rgb(0.75, 0.80, 0.90), dc = rgb(0.60, 0.65, 0.80);
    if (type === 'blank') return;
    if (type === 'lined') {
        for (let y = H - 24; y > 10; y -= 24)
            page.drawLine({ start: { x: 10, y }, end: { x: W - 10, y }, thickness: 0.4, color: lc });
        page.drawLine({ start: { x: 50, y: H - 10 }, end: { x: 50, y: 10 }, thickness: 0.6, color: rgb(0.9, 0.4, 0.4) });
    }
    if (type === 'grid') {
        const s = 14.17;
        for (let x = s; x < W; x += s) page.drawLine({ start: { x, y: H - 5 }, end: { x, y: 5 }, thickness: 0.3, color: lc });
        for (let y = s; y < H; y += s) page.drawLine({ start: { x: 5, y }, end: { x: W - 5, y }, thickness: 0.3, color: lc });
    }
    if (type === 'dotted') {
        const s = 14.17;
        for (let x = s; x < W; x += s) for (let y = s; y < H; y += s)
            page.drawCircle({ x, y, size: 0.8, color: dc });
    }
    if (type === 'cornell') {
        const ac = rgb(0.5, 0.6, 0.85);
        const tl = H - 60, kl = 120, sl = 80, ls = 20;
        page.drawLine({ start: { x: 10, y: tl }, end: { x: W - 10, y: tl }, thickness: 0.6, color: ac });
        page.drawLine({ start: { x: kl, y: tl }, end: { x: kl, y: sl }, thickness: 0.6, color: ac });
        page.drawLine({ start: { x: 10, y: sl }, end: { x: W - 10, y: sl }, thickness: 0.6, color: ac });
        for (let y = tl - ls; y > sl; y -= ls)
            page.drawLine({ start: { x: kl + 8, y }, end: { x: W - 10, y }, thickness: 0.25, color: lc });
    }
}

// ── Modal ────────────────────────────────────────────────────────
class InsertPageModal extends Modal {
    constructor(app, cur, total, onInsert) {
        super(app);
        this.cur = cur; this.total = total; this.onInsert = onInsert;
        this.opts = { position: 'after', pageType: 'lined', targetPage: cur };
    }
    onOpen() {
        const { contentEl: el } = this;
        el.empty(); el.style.padding = '16px';
        el.createEl('h2', { text: '📄 Insert new page' });
        new Setting(el).setName('Reference page').setDesc(`Current: ${this.cur} / ${this.total}`)
            .addText(t => {
                t.setValue(String(this.opts.targetPage)).onChange(v => {
                    const n = parseInt(v); if (!isNaN(n) && n >= 1 && n <= this.total) this.opts.targetPage = n;
                });
                t.inputEl.type = 'number'; t.inputEl.min = '1'; t.inputEl.max = String(this.total); t.inputEl.style.width = '80px';
            });
        new Setting(el).setName('Position')
            .addDropdown(d => d.addOption('before', '⬆ Before').addOption('after', '⬇ After')
                .setValue(this.opts.position).onChange(v => this.opts.position = v));
        new Setting(el).setName('Page type')
            .addDropdown(d => {
                PAGE_TYPES.forEach(p => d.addOption(p.id, p.label));
                d.setValue(this.opts.pageType).onChange(v => this.opts.pageType = v);
            });
        const row = el.createDiv({ attr: { style: 'display:flex;gap:10px;margin-top:18px;justify-content:flex-end;' } });
        row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const ok = row.createEl('button', { text: '✅ Insert' });
        ok.style.cssText = 'padding:6px 14px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:5px;cursor:pointer;font-weight:700;';
        ok.addEventListener('click', () => { this.close(); this.onInsert(this.opts); });
    }
    onClose() { this.contentEl.empty(); }
}

// ── Modals ───────────────────────────────────────────────────────
class ConfirmDeleteModal extends Modal {
    constructor(app, targetPage, onDelete) { super(app); this.targetPage = targetPage; this.onDelete = onDelete; }
    onOpen() {
        const { contentEl: el } = this;
        el.empty(); el.style.padding = '16px';
        el.createEl('h2', { text: '🗑️ Delete Page?' });
        const warn = el.createDiv({ attr: { style: 'background:#fee2e2;color:#991b1b;padding:12px;border-radius:6px;margin-bottom:16px;' } });
        warn.createEl('b', { text: 'Warning: ' });
        warn.createSpan({ text: 'This will delete page ' + this.targetPage + ' and all annotations on it permanently.' });
        const row = el.createDiv({ attr: { style: 'display:flex;gap:10px;margin-top:16px;justify-content:flex-end;' } });
        row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const ok = row.createEl('button', { text: '🗑️ Delete' });
        ok.style.cssText = 'padding:6px 14px;background:#dc2626;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;';
        ok.addEventListener('click', () => { this.close(); this.onDelete(this.targetPage); });
    }
    onClose() { this.contentEl.empty(); }
}

class CreatePdfModal extends Modal {
    constructor(app, plugin, onCreate) {
        super(app);
        this.plugin = plugin;
        this.onCreate = onCreate;
        this.filename = 'New Drawing.pdf';
        this.folder = this.plugin.settings.newPdfFolder || '';
        this.saveAsDefault = false;
    }
    onOpen() {
        const { contentEl: el } = this;
        el.empty(); el.style.padding = '16px';
        el.createEl('h2', { text: '📄 Create new blank PDF' });

        new Setting(el).setName('Filename')
            .addText(t => t.setValue(this.filename).onChange(v => { this.filename = v.trim(); }));

        new Setting(el).setName('Location (Folder)')
            .setDesc('Leave blank for root directory (Vault Root).')
            .addText(t => {
                t.setValue(this.folder).onChange(v => { this.folder = v.trim(); });
                t.inputEl.style.width = '100%';
            });

        new Setting(el).setName('Save this folder as default')
            .addToggle(t => t.setValue(this.saveAsDefault).onChange(v => { this.saveAsDefault = v; }));

        const row = el.createDiv({ attr: { style: 'display:flex;gap:10px;margin-top:18px;justify-content:flex-end;' } });
        row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const ok = row.createEl('button', { text: '✅ Create' });
        ok.style.cssText = 'padding:6px 14px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:5px;cursor:pointer;font-weight:700;';
        ok.addEventListener('click', async () => {
            if (this.saveAsDefault) {
                this.plugin.settings.newPdfFolder = this.folder;
                await this.plugin.saveSettings();
            }
            this.close();
            this.onCreate(this.filename, this.folder);
        });
    }
    onClose() { this.contentEl.empty(); }
}

class DeletePageModal extends Modal {
    constructor(app, cur, total, onDelete) {
        super(app);
        this.cur = cur; this.total = total; this.onDelete = onDelete;
        this.targetPage = cur;
    }
    onOpen() {
        const { contentEl: el } = this;
        el.empty(); el.style.padding = '16px';
        el.createEl('h2', { text: '🗑️ Delete page' });
        el.createEl('p', {
            text: 'This action permanently removes the page from the PDF file.',
            attr: { style: 'color:var(--text-muted);font-size:13px;margin-bottom:12px;' }
        });
        new Setting(el).setName('Page to delete').setDesc(`Total: ${this.total} pages`)
            .addText(t => {
                t.setValue(String(this.targetPage)).onChange(v => {
                    const n = parseInt(v); if (!isNaN(n) && n >= 1 && n <= this.total) this.targetPage = n;
                });
                t.inputEl.type = 'number'; t.inputEl.min = '1'; t.inputEl.max = String(this.total); t.inputEl.style.width = '80px';
            });
        const row = el.createDiv({ attr: { style: 'display:flex;gap:10px;margin-top:16px;justify-content:flex-end;' } });
        row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        const ok = row.createEl('button', { text: '🗑️ Delete' });
        ok.style.cssText = 'padding:6px 14px;background:#dc2626;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;';
        ok.addEventListener('click', () => { this.close(); this.onDelete(this.targetPage); });
    }
    onClose() { this.contentEl.empty(); }
}

class PdfNotesView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.pdfFile = null; this.pdfDoc = null; this.pageCount = 0;
        this.scale = 1.5; this.tool = 'pen'; this.color = '#000000'; this.opacity = 1.0; this.lineWidth = 3;
        this.strokes = {}; this.drawing = false; this.curStroke = null;
        this.pageCanvases = {}; this.saveTimer = null; this.visiblePage = 1;
        this.pageSizes = {}; this._observers = {};
        this.shapeStart = null; this.curPreview = null; // Shape state
        this.penId = null; this.lastMid = null;
        this.affectedParents = [];
        this.originalTool = null; // For side button temporary tool
        this.touchScrollStart = null;
        this._drawReq = null;
        this.selectedElements = []; // { pn, s }
        this.lassoPath = null;
        this.isMoving = false;
        this.isResizing = false;
        this.activeHandle = null;
        this.moveStart = null;
        this._imgCache = new Map();
        this.floatingInput = null; // Direct text input
        this.isSnipping = false;
        this.snipStart = null;
        this.snipRect = null;
        this.activeTouches = new Map();
        this.isPinching = false;
        this.pinchDist = 0;
        this.pinchScale = 1;
        this._targetScale = null;
        this.isHandScrolling = false; // Mouse hand scroll
        this.handScrollStart = null;
        
        // Global anti-scroll guard
        window.addEventListener('touchmove', (e) => {
            if (this.drawing) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }, { passive: false });
    }
    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return this.pdfFile?.basename ?? 'PDF.notes'; }
    getIcon() { return 'pencil'; }

    async setPdfFile(f) {
        this.pdfFile = f; this.strokes = {}; this.pageCanvases = {};
        this.visiblePage = 1; this._renderedScale = null; this.contentEl.empty(); this.buildUI();
        if (this.statusEl) this.statusEl.setText('⏳ Loading PDF...');
        await this.loadPdfAndAnnotations();
        await this.rebuildAll();
    }

    // ── UI ────────────────────────────────────────
    buildUI() {
        const root = this.contentEl;
        root.empty();
        root.addClass('pdf-notes-container');
        
        const isRight = this.plugin.settings.toolbarPosition === 'right';
        root.style.cssText = `display:flex;height:100%;background:#1e1e2e;flex-direction:${isRight ? 'row' : 'column'};`;

        const tb = root.createDiv();
        tb.addClass('pdf-notes-toolbar');
        
        if (isRight) {
            tb.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;background:#181825;border-left:1px solid #313244;flex-shrink:0;width:40px;order:2;';
        } else {
            tb.style.cssText = 'display:flex;align-items:center;gap:2px;padding:4px 8px;background:#181825;border-bottom:1px solid #313244;flex-shrink:0;height:40px;';
        }
        
        this.buildToolbar(tb);

        this.scrollEl = root.createDiv();
        this.scrollEl.addClass('pdf-notes-scroll');
        this.scrollEl.style.cssText = 'position:relative;flex:1;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:20px;gap:14px;background:#1e1e2e;transform-origin: center center;touch-action: pan-x pan-y;';
        if (isRight) this.scrollEl.style.order = 1;

        this.setupGlobalEvents();

        this.statusEl = root.createDiv();
        this.statusEl.style.cssText = `flex-shrink:0;padding:3px 10px;background:#181825;border-top:1px solid #313244;font-size:11px;color:#a6adc8;${isRight ? 'position:absolute;bottom:0;right:50px;border-radius:4px 0 0 0;z-index:20;' : ''}`;
    }

    buildToolbar(tb) {
        const b = (lbl, title, idOrFn, fnOrXtra, maybeXtra = '') => {
            let id = null, fn, xtra = '';
            if (typeof idOrFn === 'function') {
                fn = idOrFn; xtra = fnOrXtra || '';
            } else {
                id = idOrFn; fn = fnOrXtra; xtra = maybeXtra;
            }
            if (id && !this.plugin.settings.enabledTools.includes(id) && id !== 'shapes') return { style: {} };
            const el = tb.createEl('button');
            el.className = 'pdf-tool-btn';
            
            if (this.plugin.settings.iconType === 'emoji') {
                const icons = this.plugin.settings.toolIcons || {};
                el.textContent = icons[lbl] || icons[id] || lbl;
            } else {
                const iconName = LUCIDE_ICONS[lbl] || LUCIDE_ICONS[id];
                if (iconName) {
                    setIcon(el, iconName);
                    const svg = el.querySelector('svg');
                    if (svg) { svg.style.width = '18px'; svg.style.height = '18px'; svg.setAttribute('stroke-width', '2.5'); }
                } else {
                    el.textContent = lbl;
                }
            }
            
            el.title = title;
            if (xtra) el.style.cssText += xtra;
            el.addEventListener('click', fn); return el;
        };


        this.toggleMenu = (menu, anchor) => {
            if (!menu) return;
            if (menu.style.display !== 'none' && menu.style.display !== '') {
                menu.style.display = 'none';
            } else {
                document.querySelectorAll('.pdf-notes-menu').forEach(m => m.style.display = 'none');
                const rect = anchor.getBoundingClientRect();
                const isRight = this.plugin.settings.toolbarPosition === 'right';
                if (isRight) {
                    menu.style.right = (window.innerWidth - rect.left + 5) + 'px';
                    menu.style.top = Math.max(10, Math.min(rect.top, window.innerHeight - 200)) + 'px';
                    menu.style.left = 'auto';
                } else {
                    menu.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - 180)) + 'px';
                    menu.style.top = (rect.bottom + 5) + 'px';
                    menu.style.right = 'auto';
                }
                menu.style.display = 'flex';
            }
        };

        // Group 1: Navigation
        if (this.plugin.settings.enabledTools.includes('nav')) {
            b('prev', 'Previous', 'nav', () => this.navPage(-1));
            this.pageInfo = tb.createSpan(); this.pageInfo.style.cssText = 'font-size:11px;color:#a6adc8;min-width:35px;text-align:center;font-weight:600;';
            b('next', 'Next', 'nav', () => this.navPage(1));
            this.div(tb);
        }

        // Group 2: Zoom
        if (this.plugin.settings.enabledTools.includes('zoom')) {
            b('zoomOut', 'Zoom Out', 'zoom', () => this.zoom(-0.25));
            this.zoomInfo = tb.createSpan(); this.zoomInfo.style.cssText = 'font-size:11px;color:#a6adc8;min-width:35px;text-align:center;font-weight:600;';
            b('zoomIn', 'Zoom In', 'zoom', () => this.zoom(0.25));
            this.div(tb);
        }
        
        // Group 3: Core Tools
        if (this.plugin.settings.enabledTools.includes('scroll'))
            this.btnHand = b('scroll', 'Scroll', 'scroll', () => this.setTool('scroll'));
        if (this.plugin.settings.enabledTools.includes('select'))
            this.btnSelect = b('select', 'Select', 'select', () => this.setTool('select'));
        if (this.plugin.settings.enabledTools.includes('lasso'))
            this.btnLasso = b('lasso', 'Lasso', 'lasso', () => this.setTool('lasso'));
        
        if (this.plugin.settings.enabledTools.includes('pen')) {
            this.btnPen = b('pen', 'Pen & Color', 'pen', () => {
                const wasPen = this.tool === 'pen';
                this.setTool('pen');
                if (wasPen) this.toggleMenu(this._penMenu, this.btnPen);
            });
            this.btnPen.classList.add('has-dropdown');
            
            this._penMenu = document.body.createDiv({ cls: 'pdf-notes-menu' });
            this._penMenu.style.cssText = 'position:fixed;background:#1e1e2e;border:1px solid #45475a;border-radius:8px;display:none;flex-direction:column;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.5);padding:12px;min-width:160px;gap:10px;';

            const createRow = (label) => {
                const r = this._penMenu.createDiv({ style: 'display:flex;flex-direction:column;gap:4px;' });
                const l = r.createDiv({ style: 'display:flex;justify-content:space-between;align-items:center;' });
                l.createSpan({ text: label, style: 'font-size:10px;color:#a6adc8;font-weight:bold;text-transform:uppercase;' });
                const v = l.createSpan({ style: 'font-size:10px;color:#89b4fa;' });
                return { r, v };
            };

            const { r: cR } = createRow('Color');
            this.colorInput = cR.createEl('input', { type: 'color', style: 'width:100%;height:24px;padding:1px;background:#313244;border:1px solid #45475a;border-radius:4px;cursor:pointer;' });
            this.colorInput.value = this.color;
            this.colorInput.oninput = e => { this.color = e.target.value; this.setTool('pen'); };

            const { r: tR, v: tV } = createRow('Width');
            tV.textContent = this.lineWidth + 'px';
            const tS = tR.createEl('input', { type: 'range', style: 'width:100%;' });
            tS.min = '1'; tS.max = '15'; tS.value = String(this.lineWidth);
            tS.oninput = e => { this.lineWidth = parseInt(e.target.value); tV.textContent = this.lineWidth + 'px'; this.setTool('pen'); };

            const { r: oR, v: oV } = createRow('Opacity');
            oV.textContent = Math.round(this.opacity * 100) + '%';
            const oS = oR.createEl('input', { type: 'range', style: 'width:100%;' });
            oS.min = '1'; oS.max = '100'; oS.value = String(Math.round(this.opacity * 100));
            oS.oninput = e => { this.opacity = parseInt(e.target.value) / 100; oV.textContent = Math.round(this.opacity * 100) + '%'; this.setTool('pen'); };
        }

        if (this.plugin.settings.enabledTools.includes('eraser')) {
            this.btnErase = b('eraser', 'Eraser', 'eraser', () => {
                const wasE = this.tool === 'eraser';
                this.setTool('eraser');
                if (wasE) this.toggleMenu(this._eraseMenu, this.btnErase);
            });
            this.btnErase.classList.add('has-dropdown');
            this._eraseMenu = document.body.createDiv({ cls: 'pdf-notes-menu' });
            this._eraseMenu.style.cssText = 'position:fixed;background:#1e1e2e;border:1px solid #45475a;border-radius:8px;display:none;flex-direction:column;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.5);padding:12px;min-width:140px;';
            const r = this._eraseMenu.createDiv({ style: 'display:flex;flex-direction:column;gap:4px;' });
            r.createSpan({ text: 'Eraser Size', style: 'font-size:10px;color:#a6adc8;font-weight:bold;' });
            const sIn = r.createEl('input', { type: 'range', style: 'width:100%;' });
            sIn.min = '5'; sIn.max = '100'; sIn.value = String(this.plugin.settings.eraserSize);
            sIn.oninput = e => { this.plugin.settings.eraserSize = parseInt(e.target.value); this.plugin.saveSettings(); };
        }

        if (this.plugin.settings.enabledTools.includes('text')) {
            this.btnText = b('text', 'Text options', 'text', () => {
                const wasText = this.tool === 'text';
                this.setTool('text');
                if (wasText) this.toggleMenu(this._textMenu, this.btnText);
            });
            this.btnText.classList.add('has-dropdown');
            
            this._textMenu = document.body.createDiv({ cls: 'pdf-notes-menu' });
            this._textMenu.style.cssText = 'position:fixed;background:#1e1e2e;border:1px solid #45475a;border-radius:8px;display:none;flex-direction:column;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,0.5);padding:12px;min-width:180px;gap:10px;';

            const createRow = (label) => {
                const r = this._textMenu.createDiv({ style: 'display:flex;flex-direction:column;gap:4px;' });
                const l = r.createDiv({ style: 'display:flex;justify-content:space-between;align-items:center;' });
                l.createSpan({ text: label, style: 'font-size:10px;color:#a6adc8;font-weight:bold;text-transform:uppercase;' });
                const v = l.createSpan({ style: 'font-size:10px;color:#89b4fa;' });
                return { r, v };
            };

            const { r: cR } = createRow('Text Color');
            const textColorInput = cR.createEl('input', { type: 'color', style: 'width:100%;height:24px;padding:1px;background:#313244;border:1px solid #45475a;border-radius:4px;cursor:pointer;' });
            textColorInput.value = this.color;
            textColorInput.oninput = e => { this.color = e.target.value; if (this.colorInput) this.colorInput.value = this.color; this.setTool('text'); };

            const { r: sR, v: sV } = createRow('Font Size');
            sV.textContent = (this.plugin.settings.textSize || 16) + 'px';
            const sizeIn = sR.createEl('input', { type: 'range', style: 'width:100%;' });
            sizeIn.min = '8'; sizeIn.max = '72'; sizeIn.value = String(this.plugin.settings.textSize || 16);
            sizeIn.oninput = e => { 
                this.plugin.settings.textSize = parseInt(e.target.value); 
                sV.textContent = this.plugin.settings.textSize + 'px'; 
                this.plugin.saveSettings(); 
            };

            const { r: fR } = createRow('Font Family');
            const fontIn = fR.createEl('select', { style: 'width:100%;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;font-size:12px;' });
            ['Inter', 'Roboto', 'Open Sans', 'Arial', 'Times New Roman', 'Courier New', 'Georgia'].forEach(f => {
                const opt = fontIn.createEl('option', { text: f, value: f });
                if (f === this.plugin.settings.textFont) opt.selected = true;
            });
            fontIn.onchange = e => { 
                this.plugin.settings.textFont = e.target.value; 
                this.plugin.saveSettings(); 
            };

            const { r: otR, v: otV } = createRow('Opacity');
            otV.textContent = Math.round(this.opacity * 100) + '%';
            const otS = otR.createEl('input', { type: 'range', style: 'width:100%;' });
            otS.min = '1'; otS.max = '100'; otS.value = String(Math.round(this.opacity * 100));
            otS.oninput = e => { this.opacity = parseInt(e.target.value) / 100; otV.textContent = Math.round(this.opacity * 100) + '%'; this.setTool('text'); };
        }
        if (this.plugin.settings.enabledTools.includes('image')) this.btnImg = b('image', 'Image', 'image', () => this.setTool('image'));
        if (this.plugin.settings.enabledTools.includes('snip')) this.btnSnip = b('snip', 'Snip', 'snip', () => this.setTool('snip'));
        if (this.plugin.settings.enabledTools.includes('paste')) b('paste', 'Paste', () => this.pasteFromClipboard());

        this.div(tb);
        
        // Group 4: Shapes
        const enabledShapes = ['rect', 'circle', 'line', 'arrow'].filter(t => this.plugin.settings.enabledTools.includes(t));
        if (enabledShapes.length > 0) {
            this.btnShapes = b(enabledShapes[0], 'Shapes', 'shapes', () => this.toggleMenu(this._shapeMenu, this.btnShapes));
            this.btnShapes.classList.add('has-dropdown');
            this._shapeMenu = document.body.createDiv({ cls: 'pdf-notes-menu' });
            this._shapeMenu.style.cssText = 'position:fixed;background:#1e1e2e;border:1px solid #45475a;border-radius:8px;display:none;padding:5px;z-index:10000;gap:4px;';
            enabledShapes.forEach(s => {
                const sb = b(s, s, s, () => { this.setTool(s); this._shapeMenu.style.display = 'none'; });
                this._shapeMenu.appendChild(sb);
            });
        }

        this.div(tb);
        b('undo', 'Undo', 'undo', () => this.undo());
        b('zen', 'Zen Mode', 'zen', () => this.toggleZen());

        this.div(tb);
        b('insert', 'Insert Page', 'insert', () => this.openInsertModal());
        b('remove', 'Delete Page', 'remove', () => this.openDeleteModal());

        const sp = tb.createDiv(); sp.style.flex = '1';

        this.btnSaveAnnot = b('save', 'Save Annotations', 'save', () => this.saveAsAnnotations());
        this.btnSaveAnnot.style.background = '#a6e3a1'; this.btnSaveAnnot.style.color = '#1e1e2e';

        this.btnFlatten = b('flatten', 'Flatten PDF', 'flatten', () => this.flattenToPdf());
        this.btnFlatten.style.background = '#fab387'; this.btnFlatten.style.color = '#1e1e2e';

        
        
        if (this.selectedElements.length > 0 && this.plugin.settings.enabledTools.includes('delete')) {
            this.div(tb);
            const btnDel = tb.createEl('button');
            if (this.plugin.settings.iconType === 'lucide') {
                setIcon(btnDel, 'trash-2');
                btnDel.createSpan({ text: ' Delete', attr: { style: 'margin-left:4px;' } });
            } else {
                btnDel.textContent = '❌ Delete';
            }
            btnDel.style.cssText = 'padding:4px 10px;background:#f38ba8;border:none;border-radius:5px;color:#1e1e2e;font-weight:700;font-size:12px;cursor:pointer;margin-left:8px;box-shadow: 0 2px 5px rgba(0,0,0,0.2);display:flex;align-items:center;';
            btnDel.onclick = () => this.deleteSelected();

            const first = this.selectedElements[0].s;
            if (first.type === 'image') {
                const btnCrop = tb.createEl('button');
                if (this.plugin.settings.iconType === 'lucide') {
                    setIcon(btnCrop, 'scissors');
                    btnCrop.createSpan({ text: ' Crop', attr: { style: 'margin-left:4px;' } });
                } else {
                    btnCrop.textContent = '✂️ Crop';
                }
                btnCrop.style.cssText = 'padding:4px 10px;background:#f9e2af;border:none;border-radius:5px;color:#1e1e2e;font-weight:700;font-size:12px;cursor:pointer;margin-left:8px;box-shadow: 0 2px 5px rgba(0,0,0,0.2);display:flex;align-items:center;';
                btnCrop.onclick = () => this.cropSelected();
            }
        }
    }
    div(p) { 
        const isRight = this.plugin.settings.toolbarPosition === 'right';
        const d = p.createDiv(); 
        d.style.cssText = isRight ? 'width:16px;height:1px;background:#313244;margin:4px 0;' : 'width:1px;height:18px;background:#313244;margin:0 4px;'; 
    }
    toggleZen() {
        const root = this.contentEl.querySelector('.pdf-notes-container');
        const isZen = root.classList.toggle('pdf-notes-zen-mode');
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view.containerEl.contains(this.contentEl)) return;
            const container = leaf.view.containerEl.closest('.workspace-split');
            if (container) container.style.display = isZen ? 'none' : '';
        });
        if (isZen) {
            this._oldS = { left: document.querySelector('.workspace-ribbon.side-dock-left')?.style.display, right: document.querySelector('.workspace-ribbon.side-dock-right')?.style.display };
            document.querySelectorAll('.workspace-ribbon').forEach(r => r.style.display = 'none');
            document.querySelectorAll('.workspace-tab-header-container').forEach(h => h.style.display = 'none');
        } else {
            document.querySelectorAll('.workspace-ribbon').forEach(r => r.style.display = '');
            document.querySelectorAll('.workspace-tab-header-container').forEach(h => h.style.display = '');
        }
    }

    setTool(t) { this.tool = t; this.updateToolbar(); }
    updateToolbar() {
        const A = '#89b4fa', I = '#313244', AF = '#1e1e2e', IF = '#cdd6f4';
        [
            [this.btnHand, 'scroll'], [this.btnSelect, 'select'], [this.btnLasso, 'lasso'], 
            [this.btnPen, 'pen'], [this.btnErase, 'eraser'], [this.btnText, 'text'], [this.btnImg, 'image'], [this.btnSnip, 'snip']
        ].forEach(([b, t]) => {
            if (!b || !b.style) return;
            const active = this.tool === t;
            b.style.background = active ? A : I;
            b.style.color = active ? AF : IF;
        });
        if (this.btnShapes) {
            const isShape = ['rect', 'circle', 'line', 'arrow'].includes(this.tool);
            this.btnShapes.style.background = isShape ? A : I;
            this.btnShapes.style.color = isShape ? AF : IF;
            const icons = { rect: '▭', circle: '○', line: '╱', arrow: '→' };
            if (isShape) {
                if (this.plugin.settings.iconType === 'lucide') {
                    this.btnShapes.empty();
                    setIcon(this.btnShapes, LUCIDE_ICONS[this.tool]);
                    const svg = this.btnShapes.querySelector('svg');
                    if (svg) { 
                        svg.style.width = '22px'; 
                        svg.style.height = '22px'; 
                        svg.setAttribute('stroke-width', '3');
                    }
                    this.btnShapes.createSpan({ text: ' ▾', attr: { style: 'font-size:8px;margin-left:3px;opacity:0.7;' } });
                } else {
                    this.btnShapes.innerHTML = icons[this.tool] + ' <span style="font-size:8px;margin-left:3px;opacity:0.7;">▾</span>';
                }
            }
        }
        if (this.zoomInfo) this.zoomInfo.textContent = Math.round(this.scale * 100) + '%';
        Object.values(this.pageCanvases).forEach(({ inkCanvas }) => this.setCursor(inkCanvas));
    }
    setCursor(c) {
        if (!c) return;
        c.style.cursor = this.tool === 'scroll' ? 'grab' : this.tool === 'eraser' ? 'cell' : 'crosshair';
        if (this.tool === 'scroll') {
            c.style.touchAction = 'pan-x pan-y';
        } else if (!this.plugin.settings.allowTouch) {
            c.style.touchAction = 'pan-x pan-y';
        } else {
            c.style.touchAction = 'none';
        }
    }

    // ── Navigation ────────────────────────────────
    navPage(d) {
        const t = Math.max(1, Math.min(this.pageCount, this.visiblePage + d));
        this.scrollEl.querySelector(`[data-page="${t}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    onScroll() {
        const pages = this.scrollEl.querySelectorAll('[data-page]');
        let best = 1, bestV = 0;
        pages.forEach(p => { const r = p.getBoundingClientRect(); const v = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)); if (v > bestV) { bestV = v; best = parseInt(p.dataset.page); } });
        if (best !== this.visiblePage) { this.visiblePage = best; if (this.pageInfo) this.pageInfo.textContent = `${best}/${this.pageCount}`; }
    }
    zoom(d) {
        const old = this.scale;
        this.scale = Math.round(Math.max(0.2, Math.min(8.0, this.scale + d)) * 10) / 10;
        if (this.scale !== old) {
            this.updateToolbar();

            // Capture anchor once at start of zoom sequence (clean geometry, no transform yet)
            if (!this._zoomTimer) {
                const page = this.visiblePage;
                const pageEl = this.scrollEl?.querySelector(`[data-page="${page}"]`);
                this._zoomAnchorPage = page;
                this._zoomAnchorProgress = (pageEl && pageEl.offsetHeight > 0)
                    ? Math.max(0, (this.scrollEl.scrollTop - pageEl.offsetTop) / pageEl.offsetHeight)
                    : 0;
            }

            // Instant visual feedback anchored at viewport center
            if (this.scrollEl) {
                if (!this._renderedScale) this._renderedScale = old;
                const factor = this.scale / this._renderedScale;
                const centerY = this.scrollEl.scrollTop + this.scrollEl.clientHeight / 2;
                this.scrollEl.style.transformOrigin = `center ${centerY}px`;
                this.scrollEl.style.transform = `scale(${factor.toFixed(4)})`;
            }

            // Debounce: rebuild only after user stops clicking
            clearTimeout(this._zoomTimer);
            this._zoomTimer = setTimeout(() => {
                this._zoomTimer = null;
                const page = this._zoomAnchorPage ?? this.visiblePage;
                const progress = this._zoomAnchorProgress ?? 0;
                this._zoomAnchorPage = null;
                this._zoomAnchorProgress = null;
                // Pre-scale all measured page sizes so rebuildAll uses accurate heights
                if (this._renderedScale && this._renderedScale !== this.scale) {
                    const f = this.scale / this._renderedScale;
                    for (const num of Object.keys(this.pageSizes)) {
                        this.pageSizes[num] = { width: this.pageSizes[num].width * f, height: this.pageSizes[num].height * f };
                    }
                }
                this._renderedScale = this.scale;
                this.rebuildAll().then(() => {
                    if (this.scrollEl) this.scrollEl.style.transform = '';
                    const el = this.scrollEl?.querySelector(`[data-page="${page}"]`);
                    if (!el || !this.scrollEl) return;
                    // Let browser handle complex flexbox positioning, then offset by progress
                    el.scrollIntoView({ behavior: 'instant', block: 'start' });
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            this.scrollEl.scrollTop += progress * el.offsetHeight;
                        });
                    });
                });
            }, 350);
        }
    }

    // PDF und Annotationen laden (kombiniert)

    // ── PAGE REBUILD ────────────────────────────
    // Erstellt Platzhalter für alle Seiten, rendert nur die sichtbaren
    async rebuildAll() {
        if (!this.pdfDoc || !this.scrollEl) return;
        if (this._rebuilding) return; // Simple lock
        this._rebuilding = true;

        try {
            console.log('[PDF.notes] Zoom/Rebuild @', this.scale);
            
            // Use existing pageSizes if available (pre-scaled by zoom()), otherwise estimate from page 1
            let estW = 600 * this.scale, estH = 800 * this.scale;
            if (!Object.keys(this.pageSizes).length) {
                try {
                    const p1 = await this.pdfDoc.getPage(1);
                    const vp = p1.getViewport({ scale: this.scale });
                    estW = vp.width; estH = vp.height;
                } catch(e) {}
            } else {
                estW = this.pageSizes[1]?.width ?? estW;
                estH = this.pageSizes[1]?.height ?? estH;
            }

            for (let i = 1; i <= this.pageCount; i++) {
                let wrap = this.scrollEl.querySelector(`[data-page="${i}"]`);
                // If we have measured this page at the NEW scale already, use that
                const w = this.pageSizes[i]?.width ?? estW;
                const h = this.pageSizes[i]?.height ?? estH;

                if (!wrap) {
                    wrap = this.scrollEl.createDiv();
                    wrap.dataset.page = String(i);
                    wrap.style.cssText = `position:relative;background:#2a2a3e;border-radius:3px;box-shadow:0 4px 18px rgba(0,0,0,0.5);flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-bottom:20px;`;
                    const lbl = wrap.createDiv();
                    lbl.textContent = `Page ${i}`; lbl.style.cssText = 'font-size:18px;color:#45475a;font-weight:300;';
                }

                // Update container size to match the new scale
                wrap.style.width = w + 'px';
                wrap.style.height = h + 'px';

                // Re-attach observer for every page when scale changes, 
                // because we need to re-render at the new resolution.
                // We disconnect old ones implicitly if we tracked them, but let's just use a fresh one.
                if (this._observers[i]) this._observers[i].disconnect();

                const obs = new IntersectionObserver(entries => {
                    if (entries[0].isIntersecting) {
                        obs.disconnect(); delete this._observers[i];
                        this.renderPageInWrap(i, wrap);
                    }
                }, { root: this.scrollEl, rootMargin: '800px 0px' });
                obs.observe(wrap);
                this._observers[i] = obs;
            }

            if (this.pageInfo) this.pageInfo.textContent = `${this.visiblePage || 1}/${this.pageCount}`;
            if (this.statusEl) this.statusEl.setText(`${this.pageCount} Pages | Zoom: ${Math.round(this.scale*100)}%`);
            this.updateToolbar();
        } finally {
            this._rebuilding = false;
        }
    }

    async renderPageInWrap(num, wrap) {
        if (!this.pdfDoc) return;
        try {
            const page = await this.pdfDoc.getPage(num);
            const vp = page.getViewport({ scale: this.scale });
            this.pageSizes[num] = { width: vp.width, height: vp.height };
            wrap.style.width = vp.width + 'px'; wrap.style.height = vp.height + 'px';
            wrap.empty();
            
            const pc = wrap.createEl('canvas'); pc.width = vp.width; pc.height = vp.height;
            pc.style.cssText = 'position:absolute;inset:0;';
            await page.render({ canvasContext: pc.getContext('2d'), viewport: vp }).promise;

            const ic = wrap.createEl('canvas');
            const dpr = window.devicePixelRatio || 1;
            ic.width = vp.width * dpr; ic.height = vp.height * dpr;
            ic.style.width = `${vp.width}px`; ic.style.height = `${vp.height}px`;
            ic.style.position = 'absolute'; ic.style.inset = '0'; ic.style.zIndex = '5';
            
            const ctx = ic.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            
            this.pageCanvases[num] = { pdfCanvas: pc, inkCanvas: ic, vp, wrap };
            this.redraw(num);
        } catch (e) { console.error('[PDF.notes] Render error', num, e); }
    }

    // Logic for rebuilding handled by primary rebuildAll function above

    setupGlobalEvents() {
        // Global Paste Handling
        if (this._onPaste) window.removeEventListener('paste', this._onPaste);
        this._onPaste = ev => {
            const item = ev.clipboardData.items[0];
            if (item?.type.startsWith('image/')) {
                const f = item.getAsFile();
                if (f) this.addPastedImage(f);
            }
        };
        window.addEventListener('paste', this._onPaste);

        const el = this.scrollEl;
        const getPageAt = (e) => {
            const target = document.elementFromPoint(e.clientX, e.clientY);
            const wrap = target?.closest('[data-page]');
            if (!wrap) return null;
            return { pn: parseInt(wrap.dataset.page), wrap };
        };

        const onS = async e => {
            if (e.pointerType === 'touch') {
                this.activeTouches.set(e.pointerId, e);
                if (this.activeTouches.size >= 2) {
                    this.isPinching = true; this.drawing = false; this.touchScrollStart = null;
                    const t = Array.from(this.activeTouches.values());
                    this.pinchDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                    this.pinchScale = this.scale;
                    return;
                }
                if (!this.plugin.settings.allowTouch) {
                    this.touchScrollStart = { x: e.clientX, y: e.clientY, top: el.scrollTop, left: el.scrollLeft };
                    return;
                }
            }

            const page = getPageAt(e);
            if (!page) return;

            const canvas = page.wrap.querySelector('canvas:last-child');
            const r = canvas.getBoundingClientRect();
            const p = { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };

            // Seitentasten-Logik (Pen Side Button)
            let useTool = this.tool;
            if (e.pointerType === 'pen' && (e.buttons === 2 || e.buttons === 32)) {
                useTool = this.plugin.settings.penSideButtonTool || 'eraser';
            }
            this.activeStrokeTool = useTool;
            if (useTool === 'scroll') {
                this.isHandScrolling = true; this.penId = e.pointerId;
                this.handScrollStart = { x: e.clientX, y: e.clientY, top: el.scrollTop, left: el.scrollLeft };
                return;
            }

            e.preventDefault(); e.stopPropagation();

            if (useTool === 'text') {
                if (this.floatingInput) this.finishFloatingInput();
                const inp = document.body.createEl('textarea');
                const fontSize = (this.plugin.settings.textSize || 16) * this.scale;
                
                inp.style.cssText = `position:absolute;left:${e.clientX}px;top:${e.clientY - (fontSize/4)}px;z-index:9999;background:transparent;color:${this.color};border:none;padding:0;margin:0;font:${fontSize}px ${this.plugin.settings.textFont||'Inter'};outline:none;min-width:10px;line-height:1.2;overflow:hidden;resize:none;caret-color:${this.color};`;
                
                const resize = () => {
                    inp.style.height = 'auto';
                    inp.style.height = inp.scrollHeight + 'px';
                    inp.style.width = 'auto';
                    // Schätzwert für die Breite basierend auf längster Zeile
                    const lines = inp.value.split('\n');
                    const maxLen = Math.max(...lines.map(l => l.length));
                    inp.style.width = (maxLen + 1) + "ch";
                };
                inp.oninput = resize;
                
                inp.focus();
                this.floatingInput = { el: inp, p, pn: page.pn, mode: 'new' };
                inp.onblur = () => this.finishFloatingInput();
                inp.onkeydown = ev => { 
                    if (ev.key === 'Enter' && ev.ctrlKey) this.finishFloatingInput(); 
                    if (ev.key === 'Escape') { inp.remove(); this.floatingInput = null; } 
                };
                this.activeStrokeTool = null;
                return;
            }
            if (useTool === 'snip') {
                this.isSnipping = true; this.snipStart = p; this.activePn = page.pn;
                this.drawing = true; this.penId = e.pointerId;
                if (canvas && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
                return;
            }
            // Image removal of existing code block handled below
            if (useTool === 'image') {
                const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
                inp.onchange = ev => {
                    const f = ev.target.files[0]; if (!f) return;
                    const rd = new FileReader(); rd.onload = () => {
                        const img = new Image(); img.onload = () => {
                            const aspect = img.width / img.height;
                            const w = Math.min(200, img.width / this.scale);
                            const s = { type: 'image', data: rd.result, x: p.x, y: p.y, w, h: w / aspect, pn: page.pn, opacity: this.opacity };
                            (this.strokes[page.pn] = this.strokes[page.pn] || []).push(s);
                            this.redraw(page.pn); this.scheduleSave();
                        };
                        img.src = rd.result;
                    };
                    rd.readAsDataURL(f);
                };
                inp.click();
                this.activeStrokeTool = null;
                return;
            }

            this.drawing = true; this.penId = e.pointerId; this.activePn = page.pn;
            if (canvas && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);

            if (useTool === 'select') {
                // Check resize handles first
                for (let sel of this.selectedElements) {
                    if (sel.pn === page.pn && (sel.s.type === 'image' || sel.s.type === 'rect')) {
                        const hX = sel.s.x + sel.s.w, hY = sel.s.y + sel.s.h;
                        if (Math.hypot(p.x - hX, p.y - hY) < 15) {
                            this.isResizing = true; this.activeHandle = sel.s; this.moveStart = p;
                            return;
                        }
                    }
                }
                const hit = this.hitTest(page.pn, p);
                if (hit) {
                    if (hit.type === 'text') { this.startEditingText(hit, page.pn, e); return; }
                    if (!this.selectedElements.some(sel => sel.s === hit)) this.selectedElements = [{ pn: page.pn, s: hit }];
                    this.isMoving = true; this.moveStart = p;
                } else {
                    // Prüfen, ob wir in den Bereich eines bereits markierten Elements auf dieser Seite klicken
                    const inSelected = this.selectedElements.some(sel => {
                        if (sel.pn !== page.pn) return false;
                        const s = sel.s;
                        if (s.type === 'text' || s.type === 'image' || s.type === 'rect') return (p.x >= s.x && p.x <= s.x + (s.w || 100) && p.y >= s.y && p.y <= s.y + (s.h || 20));
                        if (s.type === 'circle') return Math.hypot(p.x - s.cx, p.y - s.cy) < Math.max(s.rx, s.ry);
                        if (s.type === 'line' || s.type === 'arrow') return this.shapeHitTest(s, p, 15);
                        if (s.points) {
                             const b = getBounds(s.points);
                             return p.x >= b.minX - 5 && p.x <= b.maxX + 5 && p.y >= b.minY - 5 && p.y <= b.maxY + 5;
                        }
                        return false;
                    });
                    if (inSelected) {
                        this.isMoving = true; this.moveStart = p;
                    } else {
                        this.selectedElements = [];
                    }
                }
                this.requestRedrawAll();
            } else if (useTool === 'lasso') {
                this.lassoStart = p;
                this.lassoRect = { x: p.x, y: p.y, w: 0, h: 0 };
            } else if (useTool === 'pen') {
                this.curStroke = { type: 'stroke', color: this.color, opacity: this.opacity, width: this.lineWidth, points: [p], pn: page.pn };
            } else if (useTool === 'eraser') {
                this.erase(page.pn, p);
            } else if (['rect', 'circle', 'line', 'arrow'].includes(useTool)) {
                this.shapeStart = p;
            }
        };

        const onM = e => {
            if (e.pointerType === 'touch') {
                this.activeTouches.set(e.pointerId, e);
                if (this.isPinching && this.activeTouches.size === 2) {
                    const t = Array.from(this.activeTouches.values());
                    const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                    const delta = d / (this.pinchDist || 1);
                    el.style.transform = `scale(${delta})`;
                    this._targetScale = Math.max(0.1, Math.min(8.0, this.pinchScale * delta));
                    return;
                }
                if (this.activeTouches.size === 1 && this.touchScrollStart) {
                    el.scrollTop = this.touchScrollStart.top - (e.clientY - this.touchScrollStart.y);
                    el.scrollLeft = this.touchScrollStart.left - (e.clientX - this.touchScrollStart.x);
                    return;
                }
            }

            if (!this.drawing || e.pointerId !== this.penId) {
                if (this.isHandScrolling && this.handScrollStart) {
                    el.scrollTop = this.handScrollStart.top - (e.clientY - this.handScrollStart.y);
                    el.scrollLeft = this.handScrollStart.left - (e.clientX - this.handScrollStart.x);
                }
                return;
            }
            const canvas = document.querySelector(`[data-page="${this.activePn}"] canvas:last-child`);
            if (!canvas) return;
            const r = canvas.getBoundingClientRect();
            const p = { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };

            const useTool = this.activeStrokeTool || this.tool;

            if (useTool === 'select') {
                if (this.isResizing && this.activeHandle) {
                    const dx = p.x - this.moveStart.x, dy = p.y - this.moveStart.y;
                    if (this.activeHandle.type === 'image') {
                        const aspect = this.activeHandle.w / this.activeHandle.h;
                        this.activeHandle.w = Math.max(10, this.activeHandle.w + dx);
                        this.activeHandle.h = this.activeHandle.w / aspect;
                    } else {
                        this.activeHandle.w = Math.max(10, this.activeHandle.w + dx);
                        this.activeHandle.h = Math.max(10, this.activeHandle.h + dy);
                    }
                    this.moveStart = p;
                    this.requestRedraw(this.activePn);
                } else if (this.isMoving && this.moveStart) {
                    const dx = p.x - this.moveStart.x, dy = p.y - this.moveStart.y;
                    this.selectedElements.forEach(sel => {
                        const s = sel.s;
                        if (s.type === 'text' || s.type === 'image' || s.type === 'rect') { s.x += dx; s.y += dy; }
                        else if (s.type === 'circle') { s.cx += dx; s.cy += dy; }
                        else if (s.type === 'line' || s.type === 'arrow') { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
                        else if (!s.type || s.type === 'stroke') s.points.forEach(pt => { pt.x += dx; pt.y += dy; });
                    });
                    this.moveStart = p;
                    this.requestRedraw(this.activePn);
                }
            } else if (useTool === 'lasso' && this.lassoStart) {
                this.lassoRect = { 
                    x: Math.min(this.lassoStart.x, p.x), 
                    y: Math.min(this.lassoStart.y, p.y), 
                    w: Math.abs(p.x - this.lassoStart.x), 
                    h: Math.abs(p.y - this.lassoStart.y) 
                };
                this.requestRedraw(this.activePn);
            } else if (useTool === 'snip' && this.snipStart) {
                this.snipRect = { x: Math.min(this.snipStart.x, p.x), y: Math.min(this.snipStart.y, p.y), w: Math.abs(p.x - this.snipStart.x), h: Math.abs(p.y - this.snipStart.y) };
                this.requestRedraw(this.activePn);
            } else if (useTool === 'pen' && this.curStroke) {
                const last = this.curStroke.points[this.curStroke.points.length - 1];
                if (Math.hypot(p.x - last.x, p.y - last.y) > 0.1) {
                    this.curStroke.points.push(p);
                    if (this.opacity < 1.0) {
                        this.requestRedraw(this.activePn);
                    } else {
                        this.drawIncremental(this.activePn, this.curStroke);
                    }
                }
            } else if (useTool === 'eraser') {
                this.erase(this.activePn, p);
            } else if (['rect', 'circle', 'line', 'arrow'].includes(useTool) && this.shapeStart) {
                this.curPreview = this.buildShape(this.shapeStart, p);
                this.requestRedraw(this.activePn);
            }
        };

        const onE = e => {
            if (e.pointerType === 'touch') {
                this.activeTouches.delete(e.pointerId);
                if (this.isPinching && this.activeTouches.size < 2) {
                    this.isPinching = false; 
                    this.scrollEl.style.transform = 'scale(1)';
                    if (this._targetScale && Math.abs(this._targetScale - this.scale) > 0.01) {
                        this.scale = Math.round(this._targetScale * 10) / 10;
                        const page = this.visiblePage;
                        const pageEl = this.scrollEl?.querySelector(`[data-page="${page}"]`);
                        const progress = (pageEl && pageEl.offsetHeight > 0)
                            ? Math.max(0, (this.scrollEl.scrollTop - pageEl.offsetTop) / pageEl.offsetHeight)
                            : 0;
                        this.rebuildAll().then(() => {
                            requestAnimationFrame(() => {
                                const el = this.scrollEl?.querySelector(`[data-page="${page}"]`);
                                if (el && this.scrollEl) {
                                    this.scrollEl.scrollTop = el.offsetTop + progress * el.offsetHeight;
                                }
                            });
                        });
                        this.updateToolbar();
                    }
                    this._targetScale = null;
                }
                this.touchScrollStart = null;
                return;
            }
            if (this.drawing && e.pointerId === this.penId) {
                this.drawing = false;
                const useTool = this.activeStrokeTool || this.tool;
                if (useTool === 'select') { this.isMoving = false; this.isResizing = false; this.activeHandle = null; this.moveStart = null; }
                else if (useTool === 'lasso' && this.lassoRect) { this.completeLasso(); this.lassoRect = null; this.lassoStart = null; this.requestRedrawAll(); }
                else if (useTool === 'snip' && this.snipRect) { this.finishSnip(); }
                else if (this.curStroke && this.curStroke.points.length > 1) (this.strokes[this.activePn] = this.strokes[this.activePn] || []).push(this.curStroke);
                else if (this.curPreview) (this.strokes[this.activePn] = this.strokes[this.activePn] || []).push(this.curPreview);
                
                this.curStroke = null; this.curPreview = null; this.shapeStart = null;
                this.activeStrokeTool = null;
                this.redraw(this.activePn); this.scheduleSave();
            }
            if (this.isHandScrolling) {
                this.isHandScrolling = false; this.handScrollStart = null;
                this.activeStrokeTool = null;
            }
        };

        el.addEventListener('pointerdown', onS);
        el.addEventListener('pointermove', onM);
        el.addEventListener('pointerup', onE); el.addEventListener('pointerleave', onE); el.addEventListener('pointercancel', onE);
        el.addEventListener('contextmenu', e => { if (e.pointerType === 'pen') e.preventDefault(); });
        el.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); this.zoom(e.deltaY>0?-0.1:0.1); } }, { passive: false });
        el.addEventListener('scroll', () => this.onScroll());
    }

    requestRedraw(pn) {
        if (this._drawReq) return;
        this._drawReq = requestAnimationFrame(() => {
            this.redrawWithPreview(pn);
            this._drawReq = null;
        });
    }

    requestRedrawAll() {
        if (this._drawReq) return;
        this._drawReq = requestAnimationFrame(() => {
            this.updateToolbar();
            this.rebuildAll();
            this._drawReq = null;
        });
    }

    drawIncremental(pn, s) {
        const d = this.pageCanvases[pn]; if (!d || s.points.length < 3) return;
        const ctx = d.inkCanvas.getContext('2d'), pts = s.points;
        const i = pts.length - 1;
        const midPrev = { x: (pts[i-2].x + pts[i-1].x) / 2, y: (pts[i-2].y + pts[i-1].y) / 2 };
        const midNow = { x: (pts[i-1].x + pts[i].x) / 2, y: (pts[i-1].y + pts[i].y) / 2 };
        
        ctx.save(); ctx.scale(this.scale, this.scale);
        ctx.beginPath(); ctx.globalAlpha = s.opacity ?? 1.0; 
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.moveTo(midPrev.x, midPrev.y);
        ctx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, midNow.x, midNow.y);
        ctx.stroke();
        ctx.restore();
    }
    drawSeg(canvas, s) {
        const pts = s.points; if (pts.length < 2) return;
        const ctx = canvas.getContext('2d'), a = pts[pts.length - 2], b = pts[pts.length - 1];
        ctx.save(); ctx.scale(this.scale, this.scale);
        ctx.beginPath(); ctx.globalAlpha = s.opacity ?? 1.0; ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.restore();
    }
    // Draws a shape or stroke on the canvas context with smoothing
    drawShape(ctx, s) {
        // Verhindert das Zeichnen des Original-Textes, während er bearbeitet wird
        if (this.floatingInput && (this.floatingInput.s === s)) return;
        
        const useTool = this.activeStrokeTool || this.tool;
        const isSelected = this.selectedElements.some(sel => sel.s === s);
        if (isSelected) {
            ctx.save(); ctx.strokeStyle = '#89b4fa'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
            if (s.type === 'text') {
                const lines = s.text.split('\n');
                const sz = s.size || 16;
                const maxLen = Math.max(...lines.map(l => l.length));
                ctx.strokeRect(s.x-2, s.y-1, (maxLen * sz * 0.6)+4, (lines.length * sz * 1.2)+2);
            }
            else if (s.type === 'image' || s.type === 'rect') {
                ctx.strokeRect(s.x-2, s.y-2, s.w+4, s.h+4);
                ctx.setLineDash([]); ctx.fillStyle = '#89b4fa'; ctx.fillRect(s.x + s.w - 4, s.y + s.h - 4, 8, 8);
            }
            else if (s.type === 'circle') { ctx.beginPath(); ctx.ellipse(s.cx, s.cy, s.rx+2, s.ry+2, 0, 0, Math.PI*2); ctx.stroke(); }
            else if (s.points) {
                // Bounding Box für Zeichnungen berechnen
                const b = getBounds(s.points);
                ctx.strokeRect(b.minX - 2, b.minY - 2, (b.maxX - b.minX) + 4, (b.maxY - b.minY) + 4);
            }
            ctx.restore();
        }
        if (useTool === 'snip' && this.snipRect) {
            ctx.save(); ctx.strokeStyle = '#f38ba8'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
            ctx.strokeRect(this.snipRect.x, this.snipRect.y, this.snipRect.w, this.snipRect.h);
            ctx.fillStyle = 'rgba(243, 139, 168, 0.1)'; ctx.fillRect(this.snipRect.x, this.snipRect.y, this.snipRect.w, this.snipRect.h);
            ctx.restore();
        }

        ctx.globalAlpha = s.opacity ?? 1.0;
        ctx.strokeStyle = s.color; ctx.lineWidth = s.lineWidth || s.width || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        
        if (s.type === 'text') {
            ctx.fillStyle = s.color;
            const sz = s.size || 16;
            ctx.font = `${sz}px ${this.plugin.settings.textFont || 'Inter'}`;
            ctx.textBaseline = 'top';
            const lines = s.text.split('\n');
            lines.forEach((line, i) => {
                ctx.fillText(line, s.x, s.y + (i * sz * 1.2));
            });
        } else if (s.type === 'image') {
            if (!this._imgCache) this._imgCache = new Map();
            let img = this._imgCache.get(s.data);
            if (!img) {
                img = new Image(); img.src = s.data;
                img.onload = () => { this._imgCache.set(s.data, img); this.requestRedraw(s.pn); };
            } else {
                ctx.drawImage(img, s.x, s.y, s.w, s.h);
            }
        } else if (!s.type || s.type === 'stroke') {
            if (!s.points || s.points.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(s.points[0].x, s.points[0].y);
            
            if (s.points.length === 2) {
                ctx.lineTo(s.points[1].x, s.points[1].y);
            } else {
                for (let i = 1; i < s.points.length - 2; i++) {
                    const xc = (s.points[i].x + s.points[i + 1].x) / 2;
                    const yc = (s.points[i].y + s.points[i + 1].y) / 2;
                    ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, xc, yc);
                }
                const n = s.points.length;
                ctx.quadraticCurveTo(s.points[n - 2].x, s.points[n - 2].y, s.points[n - 1].x, s.points[n - 1].y);
            }
            ctx.stroke();
        } else if (s.type === 'rect') { ctx.beginPath(); ctx.strokeRect(s.x, s.y, s.w, s.h); }
        else if (s.type === 'circle') { ctx.beginPath(); ctx.ellipse(s.cx, s.cy, Math.max(1, s.rx), Math.max(1, s.ry), 0, 0, Math.PI * 2); ctx.stroke(); }
        else if (s.type === 'line') { ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
        else if (s.type === 'arrow') {
            ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
            const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), sz = Math.max(8, (s.lineWidth || 2) * 5);
            ctx.beginPath(); ctx.moveTo(s.x2, s.y2);
            ctx.lineTo(s.x2 - sz * Math.cos(a - Math.PI / 6), s.y2 - sz * Math.sin(a - Math.PI / 6));
            ctx.lineTo(s.x2 - sz * Math.cos(a + Math.PI / 6), s.y2 - sz * Math.sin(a + Math.PI / 6));
            ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }
    redraw(pn) {
        const d = this.pageCanvases[pn]; if (!d) return;
        const ctx = d.inkCanvas.getContext('2d'); 
        // Clear using logical units (since dpr transform is active)
        ctx.clearRect(0, 0, d.vp.width, d.vp.height);
        ctx.save(); ctx.scale(this.scale, this.scale);
        (this.strokes[pn] || []).forEach(s => {
            if (s) this.drawShape(ctx, s);
        });
        ctx.restore();
    }
    redrawWithPreview(pn) { 
        const d = this.pageCanvases[pn]; if (!d) return;
        this.redraw(pn); // Base redraw
        const ctx = d.inkCanvas.getContext('2d');
        ctx.save(); ctx.scale(this.scale, this.scale);
        if (this.curPreview) this.drawShape(ctx, this.curPreview);
        if (this.curStroke && this.curStroke.pn === pn) this.drawShape(ctx, this.curStroke);
        const useTool = this.activeStrokeTool || this.tool;
        if (useTool === 'lasso' && this.lassoRect) {
            ctx.beginPath(); ctx.setLineDash([5, 5]); ctx.strokeStyle = '#89b4fa'; ctx.lineWidth = 1;
            ctx.strokeRect(this.lassoRect.x, this.lassoRect.y, this.lassoRect.w, this.lassoRect.h);
            ctx.fillStyle = 'rgba(137, 180, 250, 0.1)';
            ctx.fillRect(this.lassoRect.x, this.lassoRect.y, this.lassoRect.w, this.lassoRect.h);
            ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.restore();
    }
    buildShape(start, end) {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
        const b = { color: this.color, opacity: this.opacity, lineWidth: this.lineWidth };
        if (this.tool === 'rect') return { ...b, type: 'rect', x, y, w, h };
        if (this.tool === 'circle') return { ...b, type: 'circle', cx: (start.x + end.x) / 2, cy: (start.y + end.y) / 2, rx: w / 2, ry: h / 2 };
        if (this.tool === 'line') return { ...b, type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
        if (this.tool === 'arrow') return { ...b, type: 'arrow', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    }

    // ── Selection & Hit Detection ──────────────────
    hitTest(pn, p) {
        const list = this.strokes[pn]; if (!list) return null;
        for (let i = list.length - 1; i >= 0; i--) {
            const s = list[i];
            const sz = (s.size || 16);
            if (s.type === 'text') {
                const lines = s.text.split('\n');
                const maxLen = Math.max(...lines.map(l => l.length));
                const h = lines.length * sz * 1.2;
                const w = maxLen * sz * 0.6;
                if (p.x >= s.x && p.x <= s.x + w && p.y >= s.y && p.y <= s.y + h) return s;
            }
            else if (s.type === 'image' || s.type === 'rect') { if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return s; }
            else if (s.type === 'circle') { if (Math.hypot(p.x - s.cx, p.y - s.cy) < Math.max(s.rx, s.ry)) return s; }
            else if (s.type === 'line' || s.type === 'arrow') { if (this.shapeHitTest(s, p, 10)) return s; }
            else if (!s.type || s.type === 'stroke' || s.points) { 
                const isSelected = this.selectedElements.some(sel => sel.s === s);
                const threshold = isSelected ? 25 : 12; // Höhere Toleranz für bereits selektierte Striche
                if (s.points.some(pt => Math.hypot(pt.x - p.x, pt.y - p.y) < threshold)) return s; 
            }
        }
        return null;
    }

    completeLasso() {
        if (!this.lassoRect || !this.activePn) return;
        this.selectedElements = [];
        const pn = this.activePn; const list = this.strokes[pn]; if (!list) return;
        const R = this.lassoRect;
        
        const isInside = (pt) => (pt.x >= R.x && pt.x <= R.x + R.w && pt.y >= R.y && pt.y <= R.y + R.h);
        
        list.forEach(s => {
            let pts = [];
            const sz = s.size || 16;
            if (s.type === 'text') {
                const lines = s.text.split('\n');
                const maxLen = Math.max(...lines.map(l => l.length));
                pts = [
                    {x: s.x, y: s.y}, 
                    {x: s.x + (maxLen * sz * 0.6), y: s.y + (lines.length * sz * 1.2)}
                ];
            }
            else if (s.type === 'image' || s.type === 'rect') pts = [{x: s.x, y: s.y}, {x: s.x+s.w, y: s.y+s.h}, {x: s.x+s.w/2, y: s.y+s.h/2}];
            else if (s.type === 'circle') pts = [{x: s.cx, y: s.cy}, {x: s.cx-s.rx, y: s.cy}, {x: s.cx+s.rx, y: s.cy}, {x: s.cx, y: s.cy-s.ry}, {x: s.cx, y: s.cy+s.ry}];
            else if (s.type === 'line' || s.type === 'arrow') pts = [{x: s.x1, y: s.y1}, {x: s.x2, y: s.y2}, {x: (s.x1+s.x2)/2, y: (s.y1+s.y2)/2}];
            else if (s.points) {
                // Zeichnungen nehmen wir mit auf, wenn ein signifikantes Stück im Rahmen liegt
                const inCount = s.points.filter(p => isInside(p)).length;
                if (inCount > 0) this.selectedElements.push({ pn, s });
                return;
            }
            if (pts.some(p => isInside(p))) this.selectedElements.push({ pn, s });
        });
        if (this.selectedElements.length > 0) this.updateToolbar();
    }

    startEditingText(s, pn, e) {
        if (this.floatingInput) this.finishFloatingInput();
        const inp = document.body.createEl('textarea');
        inp.value = s.text;
        const canv = document.querySelector(`[data-page="${pn}"] canvas:last-child`);
        const r = canv.getBoundingClientRect();
        
        const fontSize = (s.size || 16) * this.scale;
        const sx = s.x * this.scale + r.left;
        const sy = s.y * this.scale + r.top;

        inp.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;z-index:9999;background:transparent;color:${s.color};border:none;padding:0;margin:0;font:${fontSize}px ${this.plugin.settings.textFont||'Inter'};outline:none;min-width:10px;line-height:1.2;overflow:hidden;resize:none;caret-color:${s.color};`;
        
        const resize = () => {
            inp.style.height = 'auto';
            inp.style.height = inp.scrollHeight + 'px';
            const lines = inp.value.split('\n');
            const maxLen = Math.max(...lines.map(l => l.length));
            inp.style.width = (maxLen + 1) + "ch";
        };
        inp.oninput = resize;
        resize();

        inp.focus();
        this.floatingInput = { el: inp, s, pn, mode: 'edit' };
        this.redraw(pn);
        inp.onblur = () => this.finishFloatingInput();
        inp.onkeydown = ev => { 
            if (ev.key === 'Enter' && ev.ctrlKey) this.finishFloatingInput(); 
            if (ev.key === 'Escape') { inp.remove(); this.floatingInput = null; this.redraw(pn); } 
        };
    }

    finishFloatingInput() {
        if (!this.floatingInput || this.floatingInput.isFinishing) return;
        this.floatingInput.isFinishing = true; // Lock gegen Doppel-Aufruf

        const { el, p, pn, s, mode } = this.floatingInput;
        const txt = el.value; // Kein trim(), damit Leerzeilen/Leerzeichen am Ende erhalten bleiben
        
        if (mode === 'new') {
            if (txt.trim() !== '') {
                const news = { 
                    type: 'text', 
                    text: txt, 
                    x: p.x, 
                    y: p.y, 
                    color: this.color, 
                    opacity: this.opacity,
                    size: this.plugin.settings.textSize || 16, 
                    pn 
                };
                (this.strokes[pn] = this.strokes[pn] || []).push(news);
            }
        } else if (mode === 'edit' && s) {
            if (txt.trim() === '') {
                this.strokes[pn] = this.strokes[pn].filter(item => item !== s);
            } else {
                s.text = txt;
            }
        }
        
        el.remove();
        this.floatingInput = null;
        this.redraw(pn); 
        this.scheduleSave();
    }

    async finishSnip() {
        if (!this.snipRect || !this.activePn) return;
        const pn = this.activePn; 
        const d = this.pageCanvases[pn]; 
        if (!d) return;

        const s = { ...this.snipRect }; // Auswahl kopieren
        const sc = d.vp.scale;

        // 1. Auswahlbox sofort aus den Daten entfernen und Canvas neu zeichnen
        this.snipRect = null; 
        this.snipStart = null; 
        this.isSnipping = false;
        this.redraw(pn); // Das entfernt das rote Rechteck vom Canvas

        // Ignoriere zu kleine Snips
        if (s.w < 2 || s.h < 2) {
            this.setTool('scroll');
            return;
        }

        // 2. Jetzt erst den Screenshot vom sauberen Canvas machen
        const tmp = document.createElement('canvas');
        tmp.width = s.w * sc; 
        tmp.height = s.h * sc;
        const tctx = tmp.getContext('2d');
        
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, 0, tmp.width, tmp.height);

        const pdfSrc = d.pdfCanvas;
        if (pdfSrc) {
            tctx.drawImage(pdfSrc, 
                s.x * sc, s.y * sc, s.w * sc, s.h * sc, 
                0, 0, tmp.width, tmp.height);
        }

        const inkSrc = d.inkCanvas;
        if (inkSrc) {
            const dpr = window.devicePixelRatio || 1;
            tctx.drawImage(inkSrc, 
                s.x * sc * dpr, s.y * sc * dpr, s.w * sc * dpr, s.h * sc * dpr, 
                0, 0, tmp.width, tmp.height);
        }
        
        const url = tmp.toDataURL();
        const news = { 
            type: 'image', 
            data: url, 
            x: s.x, 
            y: s.y, 
            w: s.w, 
            h: s.h, 
            pn: pn, 
            opacity: this.opacity 
        };
        (this.strokes[pn] = this.strokes[pn] || []).push(news);

        // In die Zwischenablage kopieren
        try {
            tmp.toBlob(async blob => {
                if (!blob) return;
                try {
                    const item = new ClipboardItem({'image/png': blob});
                    await navigator.clipboard.write([item]);
                    new Notice('Screenshot in Zwischenablage & Seite eingefügt! ✂️');
                } catch (err) {
                    console.error('[PDF.notes] Clipboard error', err);
                    new Notice('Eingefügt, aber Kopieren in Zwischenablage fehlgeschlagen.');
                }
            }, 'image/png');
        } catch (e) {
            console.error('[PDF.notes] Snip error', e);
        }

        this.snipRect = null; this.snipStart = null; this.isSnipping = false;
        this.redraw(pn);
        this.setTool('scroll');
    }

    async pasteFromClipboard() {
        try {
            const data = await navigator.clipboard.read();
            for (const item of data) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        this.addPastedImage(blob);
                        return;
                    }
                }
            }
            new Notice('Kein Bild in der Zwischenablage gefunden.');
        } catch (e) {
            console.error('[PDF.notes] Paste failed', e);
            new Notice('Einfügen fehlgeschlagen. Obsidian benötigt ggf. Clipboard-Rechte.');
        }
    }

    addPastedImage(fileOrBlob) {
        const rd = new FileReader(); 
        rd.onload = () => {
            const img = new Image(); 
            img.onload = () => {
                const aspect = img.width / img.height;
                const pn = this.visiblePage || 1;
                
                // Wir berechnen die sichtbare Mitte auf der aktuellen Seite
                const wrap = this.scrollEl.querySelector(`[data-page="${pn}"]`);
                let x = 100;
                let y = 100;

                if (wrap) {
                    const scrollRect = this.scrollEl.getBoundingClientRect();
                    const wrapRect = wrap.getBoundingClientRect();
                    
                    // Berechne die vertikale Mitte des Viewports relativ zum Seitenanfang
                    const viewCenter = (scrollRect.top + scrollRect.height / 2);
                    const relativeY = (viewCenter - wrapRect.top) / this.scale;
                    
                    x = (scrollRect.width / 2 - (wrapRect.left - scrollRect.left)) / this.scale;
                    y = Math.max(50, Math.min(relativeY, (wrapRect.height / this.scale) - 50));
                }
                
                const w = Math.min(250, img.width / this.scale);
                const s = { 
                    type: 'image', 
                    data: rd.result, 
                    x: x - (w / 2), // Zentriert einfügen
                    y: y - (w / aspect / 2), 
                    w, h: w / aspect, 
                    pn,
                    opacity: this.opacity 
                };
                
                (this.strokes[pn] = this.strokes[pn] || []).push(s);
                this.redraw(pn); 
                this.scheduleSave();
                new Notice('Bild im Sichtfeld eingefügt 📋');
            };
            img.src = rd.result;
        };
        rd.readAsDataURL(fileOrBlob);
    }

    cropSelected() {
        if (this.selectedElements.length !== 1) return;
        const sel = this.selectedElements[0]; if (sel.s.type !== 'image') return;
        const s = sel.s;
        const msg = 'Enter crop margins (top left bottom right) in pixels or click cancel';
        const crop = prompt(msg, '10 10 10 10');
        if (!crop) return;
        const parts = crop.split(' ').map(Number); if (parts.length !== 4) return;
        const [t, l, b, r] = parts;
        const img = new Image(); img.src = s.data;
        img.onload = () => {
            const canv = document.createElement('canvas');
            const rw = img.width / s.w, rh = img.height / s.h;
            const cx = l * rw, cy = t * rw, cw = (s.w - l - r) * rw, ch = (s.h - t - b) * rh;
            canv.width = cw; canv.height = ch;
            canv.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
            s.data = canv.toDataURL(); s.x += l; s.y += t; s.w -= (l + r); s.h -= (t + b);
            this.redraw(sel.pn); this.scheduleSave();
        };
    }

    deleteSelected() {
        if (this.selectedElements.length === 0) return;
        this.selectedElements.forEach(sel => {
            const list = this.strokes[sel.pn];
            if (list) this.strokes[sel.pn] = list.filter(item => item !== sel.s);
        });
        const pns = new Set(this.selectedElements.map(sel => sel.pn));
        this.selectedElements = [];
        pns.forEach(pn => this.redraw(pn));
        this.scheduleSave();
        this.updateToolbar();
    }

    // Checks if eraser hits a shape
    shapeHitTest(s, pos, r) {
        const rt = r + Math.max(5, (s.lineWidth || 2)); // Slightly more tolerant
        if (s.type === 'rect') return pos.x >= s.x - rt && pos.x <= s.x + s.w + rt && pos.y >= s.y - rt && pos.y <= s.y + s.h + rt && (Math.abs(pos.x - s.x) < rt || Math.abs(pos.x - s.x - s.w) < rt || Math.abs(pos.y - s.y) < rt || Math.abs(pos.y - s.y - s.h) < rt);
        if (s.type === 'circle') { const d = Math.hypot((pos.x - s.cx) / (s.rx || 1), (pos.y - s.cy) / (s.ry || 1)); return Math.abs(d - 1) < rt / Math.max(s.rx || 1, s.ry || 1); }
        if (s.type === 'line' || s.type === 'arrow') { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(pos.x - s.x1, pos.y - s.y1) < rt; const t = Math.max(0, Math.min(1, ((pos.x - s.x1) * dx + (pos.y - s.y1) * dy) / l2)); return Math.hypot(pos.x - s.x1 - t * dx, pos.y - s.y1 - t * dy) < rt; }
        return false;
    }
    // Converts shape to InkList points (PDF coordinates)
    shapeToInkPoints(s, rX, rY, pdfH) {
        const c = p => ({ x: p.x * rX, y: pdfH - p.y * rY });
        if (s.type === 'rect') return [c({ x: s.x, y: s.y }), c({ x: s.x + s.w, y: s.y }), c({ x: s.x + s.w, y: s.y + s.h }), c({ x: s.x, y: s.y + s.h }), c({ x: s.x, y: s.y })];
        if (s.type === 'circle') { const pts = []; for (let i = 0; i <= 36; i++) { const a = i / 36 * 2 * Math.PI; pts.push(c({ x: s.cx + s.rx * Math.cos(a), y: s.cy + s.ry * Math.sin(a) })); } return pts; }
        return [c({ x: s.x1, y: s.y1 }), c({ x: s.x2, y: s.y2 })];
    }
    // Serializes shape for PDF annotation contents (as % coordinates)
    shapeToContents(s, cvW, cvH) {
        const d = { t: s.type || 'stroke', c: s.color, o: s.opacity, lw: s.lineWidth || s.width };
        if (s.type === 'rect') Object.assign(d, { x: s.x / cvW, y: s.y / cvH, w: s.w / cvW, h: s.h / cvH });
        else if (s.type === 'circle') Object.assign(d, { cx: s.cx / cvW, cy: s.cy / cvH, rx: s.rx / cvW, ry: s.ry / cvH });
        else if (s.type === 'line' || s.type === 'arrow') Object.assign(d, { x1: s.x1 / cvW, y1: s.y1 / cvH, x2: s.x2 / cvW, y2: s.y2 / cvH });
        else if (s.type === 'text') Object.assign(d, { x: s.x / cvW, y: s.y / cvH, text: s.text, size: s.size });
        else if (s.type === 'image') Object.assign(d, { x: s.x / cvW, y: s.y / cvH, w: s.w / cvW, h: s.h / cvH, data: s.data });
        return JSON.stringify(d);
    }
    // Stroke eraser (removes whole strokes/shapes)
    eraseStroke(pn, pos) {
        const r = (this.plugin.settings?.eraserSize ?? 20); // no scale needed, pos is in PDF space
        if (!this.strokes[pn]) return;
        const before = this.strokes[pn].length;
        this.strokes[pn] = this.strokes[pn].filter(s => {
            if (!s.type || s.type === 'stroke') return !s.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < r);
            return !this.shapeHitTest(s, pos, r);
        });
        if (this.strokes[pn].length !== before) { this.redraw(pn); this.scheduleSave(); }
    }
    // Pixel eraser: cuts strokes, BUT shapes are deleted as a whole just like the stroke eraser
    erasePixel(pn, pos) {
        const r = (this.plugin.settings?.eraserSize ?? 20); // no scale needed
        if (!this.strokes[pn]) return;
        let changed = false; const result = [];
        for (const s of this.strokes[pn]) {
            if (s.type && s.type !== 'stroke') {
                if (this.shapeHitTest(s, pos, r)) changed = true; // Shape hit -> omit (delete)
                else result.push(s);
                continue;
            }
            let seg = []; const segs = [];
            for (const p of (s.points || [])) {
                if (Math.hypot(p.x - pos.x, p.y - pos.y) < r) { if (seg.length >= 2) segs.push(seg); seg = []; changed = true; } else seg.push(p);
            }
            if (seg.length >= 2) segs.push(seg);
            segs.forEach(sg => result.push({ ...s, points: sg }));
        }
        if (changed) { this.strokes[pn] = result; this.redraw(pn); this.scheduleSave(); }
    }
    erase(pn, pos) { if ((this.plugin.settings?.eraserMode ?? 'stroke') === 'pixel') this.erasePixel(pn, pos); else this.eraseStroke(pn, pos); }
    undo() { for (let p = this.pageCount; p >= 1; p--) { if (this.strokes[p]?.length > 0) { this.strokes[p].pop(); this.redraw(p); this.scheduleSave(); break; } } }


    // ── Saving ─────────────────────────────────
    scheduleSave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.statusEl.setText('⏳ Saving...');
        this.saveTimer = setTimeout(() => this.saveAsAnnotations(), 4000);
    }

    // Saving as editable PDF Ink annotation (cross-device editable)
    async saveAsAnnotations() {
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
        if (!Object.values(this.strokes).some(a => a?.length > 0)) { this.statusEl.setText('No drawings.'); return; }
        this.statusEl.setText('📝 Saving annotation...');
        if (this.btnSaveAnnot) this.btnSaveAnnot.disabled = true;
        try {
            const pdfLib = PDFLib;
            const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } = pdfLib;
            const buf = await this.app.vault.adapter.readBinary(this.pdfFile.path);
            const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
            const pages = doc.getPages();

            for (const [pgStr, strokes] of Object.entries(this.strokes)) {
                const pgNum = parseInt(pgStr);
                const page = pages[pgNum - 1]; if (!page) continue;
                const { width: pdfW, height: pdfH } = page.getSize();

                // Remove existing PDF Ink annotations from this page
                let annotArr;
                try { annotArr = page.node.lookup(PDFName.of('Annots'), PDFArray); } catch (_) { }
                if (annotArr) {
                    const keep = [];
                    for (let j = 0; j < annotArr.size(); j++) {
                        try {
                            const ref = annotArr.get(j);
                            const ann = doc.context.lookup(ref, PDFDict);
                            let nmObj = ann?.lookupMaybe(PDFName.of('NM'), PDFString);
                            if (!nmObj) nmObj = ann?.lookupMaybe(PDFName.of('NM'), pdfLib.PDFHexString);
                            let nmStr = nmObj ? (nmObj.decodeText ? nmObj.decodeText() : nmObj.asString()) : null;
                            if (!nmStr) { const n2 = ann?.lookupMaybe(PDFName.of('NM'), PDFName); if (n2) nmStr = n2.asString(); }
                            if (!nmStr || (!nmStr.startsWith('pdfnotes-') && !nmStr.startsWith('pdfink-') && !nmStr.startsWith('pdfstift-'))) keep.push(ref);
                        } catch (_) { }
                    }
                    const newArr = doc.context.obj([]);
                    keep.forEach(r => newArr.push(r));
                    page.node.set(PDFName.of('Annots'), newArr);
                    annotArr = newArr;
                } else {
                    annotArr = doc.context.obj([]);
                    page.node.set(PDFName.of('Annots'), annotArr);
                }

                if (!strokes?.length) continue;

                for (let si = 0; si < strokes.length; si++) {
                    const s = strokes[si]; if (!s) continue;
                    const isShape = s.type && s.type !== 'stroke';
                    let flat, rect;
                    const cvW = pdfW; const cvH = pdfH;
                    
                    if (s.type === 'text') {
                        rect = [s.x, pdfH - s.y - (s.size || 16), s.x + 100, pdfH - s.y];
                        flat = [s.x, pdfH - s.y, s.x + 1, pdfH - s.y + 1];
                    } else if (s.type === 'image') {
                        rect = [s.x, pdfH - s.y - s.h, s.x + s.w, pdfH - s.y];
                        flat = [s.x, pdfH - s.y, s.x + 1, pdfH - s.y + 1];
                    } else if (isShape) {
                        const pts = this.shapeToInkPoints(s, 1, 1, pdfH);
                        const b = getBounds(pts);
                        rect = [b.minX - 4, b.minY - 4, b.maxX + 4, b.maxY + 4];
                        flat = pts.flatMap(p => [p.x, p.y]);
                    } else {
                        if (!s.points || s.points.length < 2) continue;
                        const rawPts = s.points.map(p => ({ x: p.x, y: pdfH - p.y }));
                        const pts = smoothPoints(rawPts, 5);
                        const b = getBounds(pts);
                        rect = [b.minX - 4, b.minY - 4, b.maxX + 4, b.maxY + 4];
                        flat = pts.flatMap(p => [p.x, p.y]);
                    }
                    const { r, g: g2, b } = hexRgb(s.color || '#000000');
                    const lw = Math.max(0.5, s.lineWidth || s.width || 2);
                    const op = s.opacity ?? 1.0;
                    const annotObj = { 
                        Type: 'Annot', 
                        Subtype: 'Ink', 
                        Rect: rect, 
                        InkList: [flat], 
                        C: [r, g2, b], 
                        BS: { W: lw }, 
                        F: 4, 
                        NM: PDFString.of(`pdfnotes-${si}`),
                        CA: op,
                        ca: op
                    };
                    annotObj.Contents = PDFString.of(this.shapeToContents(s, cvW, cvH)); // All metadata (color, opacity, shape) always in Contents
                    annotArr.push(doc.context.register(doc.context.obj(annotObj)));
                }
            }
            await this.app.vault.adapter.writeBinary(this.pdfFile.path, await doc.save());
            this.statusEl.setText('✅ Annotation saved!');
            new Notice('PDF.notes: Annotation saved 📝');
        } catch (err) {
            this.statusEl.setText('❌ ' + err.message);
            console.error('[PDF.notes] Annotation error:', err);
            new Notice('Error: ' + err.message, 6000);
        } finally { if (this.btnSaveAnnot) this.btnSaveAnnot.disabled = false; }
    }

    // Flatten drawings permanently (cannot be undone)
    async flattenToPdf() {
        if (!Object.values(this.strokes).some(a => a?.length > 0)) { this.statusEl.setText('No drawings.'); return; }
        if (!confirm('🔥 Flatten drawings PERMANENTLY into the PDF?\n(Cannot be erased afterwards, even after restart)')) return;
        this.statusEl.setText('🔥 Flattening...'); if (this.btnFlatten) this.btnFlatten.disabled = true;
        try {
            const lib = PDFLib;
            const { PDFDocument, rgb, PDFName, PDFArray, PDFDict, PDFString, PDFHexString, LineCapStyle, LineJoinStyle } = lib;
            const buf = await this.app.vault.adapter.readBinary(this.pdfFile.path);
            const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
            const pages = doc.getPages();
            for (const [ks, strokes] of Object.entries(this.strokes)) {
                const pn = parseInt(ks); if (!strokes?.length) continue;
                const pg = pages[pn - 1]; if (!pg) continue;
                const { width: pW, height: pH } = pg.getSize();
                // Remove Ink annotations from this page (they are now being flattened)
                try {
                    const annotArr = pg.node.lookup(PDFName.of('Annots'), PDFArray);
                    if (annotArr) {
                        const keep = [];
                        for (let j = 0; j < annotArr.size(); j++) {
                            try {
                                const ref = annotArr.get(j);
                                const ann = doc.context.lookup(ref, PDFDict);
                                let nmObj = ann?.lookupMaybe(PDFName.of('NM'), PDFString);
                                if (!nmObj) nmObj = ann?.lookupMaybe(PDFName.of('NM'), PDFHexString);
                                let nmStr = nmObj ? (nmObj.decodeText ? nmObj.decodeText() : nmObj.asString()) : null;
                                if (!nmStr) { const n2 = ann?.lookupMaybe(PDFName.of('NM'), PDFName); if (n2) nmStr = n2.asString(); }
                                if (!nmStr || (!nmStr.startsWith('pdfnotes-') && !nmStr.startsWith('pdfink-') && !nmStr.startsWith('pdfstift-'))) keep.push(ref);
                            } catch (_) { }
                        }
                        const newArr = doc.context.obj([]); keep.forEach(r => newArr.push(r));
                        pg.node.set(PDFName.of('Annots'), newArr);
                    }
                } catch (_) { }
                
                // Flatten vectors/shapes
                for (const s of strokes) {
                    if (!s) continue;
                    const { r, g: g2, b } = hexRgb(s.color || '#000000');
                    const co = rgb(r, g2, b);
                    const lw = Math.max(0.5, s.lineWidth || s.width || 2);
                    const op = s.opacity ?? 1.0;

                    if (s.type === 'text') {
                        pg.drawText(s.text, { x: s.x, y: pH - s.y - (s.size || 16), size: s.size || 16, color: co, opacity: op });
                    } else if (s.type === 'image') {
                        try {
                            const data = s.data.split(',')[1];
                            const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
                            const pdfImg = s.data.includes('jpeg') || s.data.includes('jpg') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
                            pg.drawImage(pdfImg, { x: s.x, y: pH - s.y - s.h, width: s.w, height: s.h, opacity: op });
                        } catch (e) { console.error('[PDF.notes] Image flatten error', e); }
                    } else if (!s.type || s.type === 'stroke') {
                        if (!s.points || s.points.length < 2) continue;
                        
                        // Use drawSvgPath with canvas coords + y:pH for correct positioning.
                        // Quadratic Bézier curves (Q) for smooth, soft strokes – matching canvas rendering.
                        const pts = s.points;
                        let path = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
                        if (pts.length === 2) {
                            path += ` L ${pts[1].x.toFixed(2)} ${pts[1].y.toFixed(2)}`;
                        } else {
                            for (let j = 1; j < pts.length - 1; j++) {
                                const xc = (pts[j].x + pts[j + 1].x) / 2;
                                const yc = (pts[j].y + pts[j + 1].y) / 2;
                                path += ` Q ${pts[j].x.toFixed(2)} ${pts[j].y.toFixed(2)} ${xc.toFixed(2)} ${yc.toFixed(2)}`;
                            }
                            // Final segment to last point
                            const last = pts[pts.length - 1];
                            const prev = pts[pts.length - 2];
                            path += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
                        }
                        pg.drawSvgPath(path, {
                            x: 0, y: pH,
                            borderColor: co,
                            borderWidth: lw,
                            borderOpacity: op,
                            borderLineCap: LineCapStyle ? LineCapStyle.Round : 1,
                            borderLineJoin: LineJoinStyle ? LineJoinStyle.Round : 1
                        });
                    } else if (s.type === 'rect') {
                        pg.drawRectangle({ x: s.x, y: pH - (s.y + s.h), width: s.w, height: s.h, borderColor: co, borderWidth: lw, borderOpacity: op, opacity: op });
                    } else if (s.type === 'circle') {
                        pg.drawEllipse({ x: s.cx, y: pH - s.cy, xScale: s.rx, yScale: s.ry, borderColor: co, borderWidth: lw, borderOpacity: op, opacity: op });
                    } else if (s.type === 'line' || s.type === 'arrow') {
                        const y1 = pH - s.y1, y2 = pH - s.y2;
                        if (s.type === 'line') {
                            pg.drawLine({ start: { x: s.x1, y: y1 }, end: { x: s.x2, y: y2 }, thickness: lw, color: co, opacity: op, lineCap: LineCapStyle ? LineCapStyle.Round : 1 });
                        } else {
                            const ang = Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1), sz = Math.max(6, Math.max(0.5, lw) * 4);
                            const p1x = s.x2 - sz * Math.cos(ang - Math.PI / 6), p1y = y2 - sz * Math.sin(ang - Math.PI / 6);
                            const p2x = s.x2 - sz * Math.cos(ang + Math.PI / 6), p2y = y2 - sz * Math.sin(ang + Math.PI / 6);
                            const path = `M ${s.x1} ${y1} L ${s.x2} ${y2} M ${p1x} ${p1y} L ${s.x2} ${y2} L ${p2x} ${p2y}`;
                            pg.drawSvgPath(path, { 
                                borderColor: co, 
                                borderWidth: lw, 
                                borderOpacity: op, 
                                borderLineCap: LineCapStyle ? LineCapStyle.Round : 1, 
                                borderLineJoin: LineJoinStyle ? LineJoinStyle.Round : 1,
                                opacity: op
                            });
                        }
                    }
                }
            }
            const docBytes = await doc.save();
            // Robust ArrayBuffer conversion for Obsidian vault.adapter.writeBinary
            const finalBuffer = docBytes.buffer.slice(docBytes.byteOffset, docBytes.byteOffset + docBytes.byteLength);
            await this.app.vault.adapter.writeBinary(this.pdfFile.path, finalBuffer);
            this.statusEl.setText('✅ Flattened!'); new Notice('PDF.notes: Flattened 🔥');
            // Reload the PDF from disk so the flattened strokes become visible
            await this.setPdfFile(this.pdfFile);
        } catch (err) { this.statusEl.setText('❌ ' + err.message); new Notice('Error: ' + err.message, 6000); }
        finally { if (this.btnFlatten) this.btnFlatten.disabled = false; }
    }

    // Reads existing PDF-Ink annotations and removes them from the PDF.js render buffer,
    // so they don't appear as a "ghost image" in the background and can still be erased.
    async loadPdfAndAnnotations() {
        try {
            const buf = await this.app.vault.adapter.readBinary(this.pdfFile.path);
            let u8ForPdfJs = new Uint8Array(buf);

            try {
                const pdfLib = PDFLib;
                const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } = pdfLib;
                const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
                const pages = doc.getPages();
                const sc = this.scale;
                let strippedAnnots = false;

                for (let i = 0; i < pages.length; i++) {
                    const page = pages[i]; const pgNum = i + 1;
                    const { width: pdfW, height: pdfH } = page.getSize();
                    let annotArr;
                    try { annotArr = page.node.lookup(PDFName.of('Annots'), PDFArray); } catch (_) { continue; }
                    if (!annotArr) continue;

                    const keep = [];
                    for (let j = 0; j < annotArr.size(); j++) {
                        try {
                            const ref = annotArr.get(j);
                            const ann = doc.context.lookup(ref, PDFDict); if (!ann) { keep.push(ref); continue; }
                            let nmObj = ann.lookupMaybe(PDFName.of('NM'), PDFString);
                            if (!nmObj) nmObj = ann.lookupMaybe(PDFName.of('NM'), pdfLib.PDFHexString);
                            let nmStr = nmObj ? (nmObj.decodeText ? nmObj.decodeText() : nmObj.asString()) : null;
                            if (!nmStr) { const n2 = ann.lookupMaybe(PDFName.of('NM'), PDFName); if (n2) nmStr = n2.asString(); }
                            if (!nmStr || (!nmStr.startsWith('pdfnotes-') && !nmStr.startsWith('pdfink-') && !nmStr.startsWith('pdfstift-'))) { keep.push(ref); continue; }
                            // It's one of our annotations! -> parse & strip
                            strippedAnnots = true;
                            // Read color
                            let r = 0, g2 = 0, b = 0;
                            try { const cArr = ann.lookup(PDFName.of('C'), PDFArray); if (cArr?.size() >= 3) { r = cArr.get(0).asNumber(); g2 = cArr.get(1).asNumber(); b = cArr.get(2).asNumber(); } } catch (_) { }
                            const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
                            let color = `#${toHex(r)}${toHex(g2)}${toHex(b)}`;
                            let lw = 2;
                            try { const bs = ann.lookup(PDFName.of('BS'), PDFDict); if (bs) { const w = bs.lookupMaybe(PDFName.of('W')); if (w) lw = w.asNumber(); } } catch (_) { }
                            let isShape = false;
                            let opacity = 1.0;
                            try {
                                let contentsObj = ann.lookupMaybe(PDFName.of('Contents'), PDFString);
                                if (!contentsObj) contentsObj = ann.lookupMaybe(PDFName.of('Contents'), pdfLib.PDFHexString);
                                if (contentsObj) {
                                    const d = JSON.parse(contentsObj.decodeText ? contentsObj.decodeText() : contentsObj.asString());
                                    if (d && d.t) {
                                        color = d.c || color;
                                        lw = d.lw || lw;
                                        opacity = d.o ?? 1.0;
                                        if (d.t !== 'stroke') {
                                            const cvW = pdfW, cvH = pdfH;
                                            const shape = { type: d.t, color, opacity, lineWidth: lw, pn: pgNum };
                                            if (d.t === 'rect') Object.assign(shape, { x: d.x * cvW, y: d.y * cvH, w: d.w * cvW, h: d.h * cvH });
                                            else if (d.t === 'circle') Object.assign(shape, { cx: d.cx * cvW, cy: d.cy * cvH, rx: d.rx * cvW, ry: d.ry * cvH });
                                            else if (d.t === 'text') Object.assign(shape, { x: d.x * cvW, y: d.y * cvH, text: d.text, size: d.size });
                                            else if (d.t === 'image') Object.assign(shape, { x: d.x * cvW, y: d.y * cvH, w: d.w * cvW, h: d.h * cvH, data: d.data });
                                            else Object.assign(shape, { x1: d.x1 * cvW, y1: d.y1 * cvH, x2: d.x2 * cvW, y2: d.y2 * cvH });
                                            (this.strokes[pgNum] = this.strokes[pgNum] || []).push(shape);
                                            isShape = true;
                                        }
                                    }
                                }
                            } catch (_) { }
                            if (isShape) continue; // Form geladen → InkList überspringen
                            // Fallback: als Strich laden (InkList)
                            const inkList = ann.lookup(PDFName.of('InkList'), PDFArray); if (!inkList) continue;
                            for (let k = 0; k < inkList.size(); k++) {
                                const flatPts = inkList.lookup(k, PDFArray); if (!flatPts) continue;
                                const points = [];
                                for (let p = 0; p + 1 < flatPts.size(); p += 2) {
                                    try { points.push({ x: flatPts.get(p).asNumber(), y: pdfH - flatPts.get(p + 1).asNumber() }); } catch (_) { }
                                }
                                if (points.length >= 2) {
                                    (this.strokes[pgNum] = this.strokes[pgNum] || []).push({ type: 'stroke', color, width: lw, opacity, points });
                                }
                            }
                        } catch (_) { }
                    }
                    if (strippedAnnots) {
                        const newArr = doc.context.obj([]);
                        keep.forEach(r => newArr.push(r));
                        page.node.set(PDFName.of('Annots'), newArr);
                    }
                }

                if (strippedAnnots) {
                    const cleanBuf = await doc.save();
                    u8ForPdfJs = new Uint8Array(cleanBuf.buffer, cleanBuf.byteOffset, cleanBuf.byteLength);
                }
                console.log('[PDF.notes] Annotations loaded:', Object.values(this.strokes).flat().length, 'strokes');
            } catch (innerErr) {
                console.warn('[PDF.notes] Error preprocessing annotations:', innerErr.message);
                // Fallback: use original PDF without stripping
            }

            // Now start PDF.js with the clean buffer
            const lib = await this.getPdfJs(); if (!lib) throw new Error('pdf.js not found');
            if (this.pdfDoc) this.pdfDoc.destroy();
            this.pdfDoc = await lib.getDocument({ data: u8ForPdfJs }).promise;
            this.pageCount = this.pdfDoc.numPages;

        } catch (e) {
            console.error('[PDF.notes] loadPdfAndAnnotations fatal failure:', e);
            new Notice('Error loading PDF!');
        }
    }

    // ── Insert Page ───────────────────────────
    openInsertModal() { new InsertPageModal(this.app, this.visiblePage, this.pageCount, opts => this.insertPage(opts)).open(); }

    async insertPage({ position, pageType, targetPage }) {
        this.statusEl.setText('📄 Calculating...');
        try {
            const pdfLib = PDFLib;
            const { PDFDocument, rgb } = pdfLib;
            const origBytes = await this.app.vault.adapter.readBinary(this.pdfFile.path);

            // Backup anlegen (je nach Einstellung)
            const bMode = this.plugin.settings?.backupMode ?? 'beside';
            if (bMode !== 'none') {
                const vaultPath = this.pdfFile.path;
                const backupPath = vaultPath + '.bak';
                await this.app.vault.adapter.writeBinary(backupPath, origBytes);
                console.log('[PDF.notes] Backup:', backupPath);
            }

            const srcDoc = await PDFDocument.load(origBytes, { ignoreEncryption: true });
            // Source size from neighbor page
            let rW = 595.28, rH = 841.89;
            const ri = Math.min(targetPage - 1, srcDoc.getPageCount() - 1);
            if (ri >= 0) { const sz = srcDoc.getPage(ri).getSize(); rW = sz.width; rH = sz.height; }

            // Insert index (0-based)
            const idx = position === 'before' ? targetPage - 1 : targetPage;

            // Copy ALL pages at once → consistent references
            const newDoc = await PDFDocument.create();
            const allIdx = Array.from({ length: srcDoc.getPageCount() }, (_, i) => i);
            const allCopied = await newDoc.copyPages(srcDoc, allIdx);

            // Pages BEFORE insertion point
            for (let i = 0; i < idx; i++) newDoc.addPage(allCopied[i]);

            // New page
            const np = newDoc.addPage([rW, rH]);
            np.drawRectangle({ x: 0, y: 0, width: rW, height: rH, color: rgb(1, 1, 1), opacity: 1 });
            drawPattern(np, pageType, pdfLib);

            // Pages AFTER insertion point
            for (let i = idx; i < srcDoc.getPageCount(); i++) newDoc.addPage(allCopied[i]);

            // Save
            this.statusEl.setText('📄 Writing PDF...');
            await this.app.vault.adapter.writeBinary(this.pdfFile.path, await newDoc.save());
            new Notice(`📄 Page inserted (${PAGE_TYPES.find(p => p.id === pageType)?.label || pageType}) ✅`);

            // Shift stroke indices
            const ns = {};
            for (const [k, v] of Object.entries(this.strokes)) {
                const n = parseInt(k); ns[n >= idx + 1 ? n + 1 : n] = v;
            }
            this.strokes = ns;

            // Shift pageSizes
            const nps = {};
            for (const [k, v] of Object.entries(this.pageSizes)) {
                const n = parseInt(k); nps[n >= idx + 1 ? n + 1 : n] = v;
            }
            this.pageSizes = nps;

            // Reload PDF and rebuild lazy list
            await this.loadPdfAndAnnotations();
            await this.rebuildAll();

            // Scroll to new page
            const scrollTo = position === 'before' ? targetPage : targetPage + 1;
            setTimeout(() => {
                this.scrollEl.querySelector(`[data-page="${scrollTo}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);

        } catch (err) {
            this.statusEl.setText('❌ ' + err.message);
            console.error('[PDF.notes] Insertion error:', err);
            new Notice('Error: ' + err.message, 6000);
        }
    }

    // ── Delete Page ───────────────────────────────
    openDeleteModal() {
        if (this.pageCount <= 1) { new Notice('A PDF must have at least one page.'); return; }
        new DeletePageModal(this.app, this.visiblePage, this.pageCount, pg => this.deletePage(pg)).open();
    }

    async deletePage(pageNum) {
        if (pageNum < 1 || pageNum > this.pageCount) { new Notice('Invalid page number.'); return; }
        if (this.pageCount <= 1) { new Notice('Cannot delete the last page.'); return; }
        this.statusEl.setText('🗑️ Deleting page ' + pageNum + ' ...');
        try {
            const pdfLib = PDFLib;
            const { PDFDocument } = pdfLib;
            const origBytes = await this.app.vault.adapter.readBinary(this.pdfFile.path);

            // Backup (same logic as insertion)
            const bMode = this.plugin.settings?.backupMode ?? 'beside';
            if (bMode !== 'none') {
                const vaultPath = this.pdfFile.path;
                const backupPath = vaultPath + '.bak';
                await this.app.vault.adapter.writeBinary(backupPath, origBytes);
            }

            const srcDoc = await PDFDocument.load(origBytes, { ignoreEncryption: true });
            const srcCount = srcDoc.getPageCount();
            const delIdx = pageNum - 1; // 0-based

            // Copy all pages except the deleted one
            const newDoc = await PDFDocument.create();
            const keepIndices = Array.from({ length: srcCount }, (_, i) => i).filter(i => i !== delIdx);
            const copied = await newDoc.copyPages(srcDoc, keepIndices);
            copied.forEach(p => newDoc.addPage(p));

            await this.app.vault.adapter.writeBinary(this.pdfFile.path, await newDoc.save());
            new Notice(`🗑️ Page ${pageNum} deleted ✅`);

            // Adjust strokes: remove page, shift following
            const ns = {};
            for (const [k, v] of Object.entries(this.strokes)) {
                const n = parseInt(k);
                if (n === pageNum) continue;          // discard deleted page
                ns[n > pageNum ? n - 1 : n] = v;   // shift following back
            }
            this.strokes = ns;

            // Adjust pageSizes
            const nps = {};
            for (const [k, v] of Object.entries(this.pageSizes)) {
                const n = parseInt(k);
                if (n === pageNum) continue;
                nps[n > pageNum ? n - 1 : n] = v;
            }
            this.pageSizes = nps;

            // Reload PDF and rebuild lazy list
            await this.loadPdfAndAnnotations();
            await this.rebuildAll();

            // Scroll to neighbor page
            const scrollTarget = Math.min(pageNum, this.pageCount);
            setTimeout(() => {
                this.scrollEl.querySelector(`[data-page="${scrollTarget}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);

        } catch (err) {
            this.statusEl.setText('❌ ' + err.message);
            console.error('[PDF.notes] Deletion error:', err);
            new Notice('Error: ' + err.message, 6000);
        }
    }

    async getPdfJs() {
        if (window.pdfjsLib) {
            if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                // Try guessing worker from core
                try {
                   const r = window.require && window.require('@electron/remote');
                   if (r) {
                       const ap = r.app.getAppPath();
                       const wPath = nodePath.join(ap, 'node_modules/pdfjs-dist/build/pdf.worker.js');
                       if (fs.existsSync(wPath)) window.pdfjsLib.GlobalWorkerOptions.workerSrc = wPath;
                   }
                } catch(e) {}
            }
            return window.pdfjsLib;
        }
        try { const r = window.require && window.require('@electron/remote'); if (r) { const ap = r.app.getAppPath(); for (const c of [nodePath.join(ap, 'node_modules/pdfjs-dist/build/pdf.js'), nodePath.join(ap, '../app.asar.unpacked/node_modules/pdfjs-dist/build/pdf.js')]) { if (fs.existsSync(c)) return window.require(c); } } } catch (_) { }
        try { return window.require('pdfjs-dist'); } catch (_) { }
        return null;
    }

    async onClose() {
        if (this._onPaste) window.removeEventListener('paste', this._onPaste);
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; await this.saveAsAnnotations(); }
        Object.values(this._observers).forEach(o => o.disconnect());
        if (this.pdfDoc) this.pdfDoc.destroy().catch(() => { });
    }
}

// ── Settings Tab ─────────────────────────────────────────────
class PdfNotesSettingTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl: el } = this;
        el.empty();
        el.createEl('h2', { text: '📝 PDF.notes – Settings' });

        // ── TOP WARNING BANNER ──────────────────────────────
        const banner = el.createDiv();
        banner.style.cssText = 'padding:15px; background: rgba(255, 100, 0, 0.1); border: 1px solid #ff6400; border-radius: 8px; margin-bottom: 20px;';
        banner.createEl('h3', { text: '⚠️ Early Version', attr: { style: 'margin: 0 0 10px 0; color: #ff6400;' } });
        banner.createEl('p', {
            text: 'This is the FIRST version of PDF.notes. Please be aware that bugs might occur. Always keep backups of your important documents!',
            attr: { style: 'margin: 0; font-size: 14px; line-height: 1.4;' }
        });

        // ── New File Section ──────────────────────────────────
        el.createEl('h3', { text: '📄 New File' });

        new Setting(el)
            .setName('Default save location')
            .setDesc('Folder where new PDFs will be stored by default (empty = Vault root).')
            .addText(t => {
                t.setValue(this.plugin.settings.newPdfFolder).onChange(async v => {
                    this.plugin.settings.newPdfFolder = v.trim();
                    await this.plugin.saveSettings();
                });
                t.inputEl.style.width = '300px';
            });

        new Setting(el)
            .setName('Create blank PDF')
            .setDesc('Generates a blank, white PDF page.')
            .addButton(b => b.setButtonText('➕ New PDF').setCta().onClick(() => this.plugin.createNewPdf()));

        el.createEl('h3', { text: '💾 Backup on page insertion' });
        el.createEl('p', { text: 'A backup copy of the PDF is created before every insertion or deletion operation.', attr: { style: 'color:var(--text-muted);font-size:13px;margin-bottom:10px;' } });

        let folderRow;
        new Setting(el)
            .setName('Backup mode')
            .setDesc('Where should the backup copy be saved?')
            .addDropdown(dd => {
                dd.addOption('beside', '📂 Next to the PDF file')
                    .addOption('folder', '📁 In a separate folder')
                    .addOption('none', '🚫 No backup')
                    .setValue(this.plugin.settings.backupMode)
                    .onChange(async v => {
                        this.plugin.settings.backupMode = v;
                        await this.plugin.saveSettings();
                        if (folderRow) folderRow.settingEl.style.display = v === 'folder' ? '' : 'none';
                    });
            });

        folderRow = new Setting(el)
            .setName('Backup folder')
            .setDesc('Absolute path to the destination folder (will be created automatically if needed).')
            .addText(t => {
                t.setPlaceholder('e.g. C:\\Backups\\PDF')
                    .setValue(this.plugin.settings.backupFolder)
                    .onChange(async v => { this.plugin.settings.backupFolder = v.trim(); await this.plugin.saveSettings(); });
                t.inputEl.style.width = '300px';
            });
        folderRow.settingEl.style.display = this.plugin.settings.backupMode === 'folder' ? '' : 'none';

        const info = el.createDiv();
        info.style.cssText = 'margin-top:10px;padding:10px 14px;background:var(--background-secondary);border-radius:6px;font-size:12px;color:var(--text-muted);line-height:1.6;';
        info.createEl('b', { text: 'Filename: ' });
        info.createEl('code', { text: 'filename.pdf.bak' });
        info.createEl('br');
        info.createSpan({ text: 'Overwritten with each insert/delete action (always state before the change).' });

        // ── Eraser Section ──────────────────────────────────
        el.createEl('h3', { text: '⬛ Eraser' });

        new Setting(el)
            .setName('Eraser mode')
            .setDesc('Stroke eraser removes the entire stroke on touch. Pixel eraser deletes only the touched area.')
            .addDropdown(dd => {
                dd.addOption('stroke', '🗂 Stroke Eraser (entire stroke)')
                    .addOption('pixel', '✂️ Pixel Eraser (touched area only)')
                    .setValue(this.plugin.settings.eraserMode)
                    .onChange(async v => { this.plugin.settings.eraserMode = v; await this.plugin.saveSettings(); });
            });

        new Setting(el)
            .setName('Eraser size')
            .setDesc('Radius of the eraser in pixels (10 = small · 20 = medium · 40 = large).')
            .addSlider(sl => {
                sl.setLimits(5, 80, 5)
                    .setValue(this.plugin.settings.eraserSize)
                    .setDynamicTooltip()
                    .onChange(async v => { this.plugin.settings.eraserSize = v; await this.plugin.saveSettings(); });
            });

        new Setting(el)
            .setName('Text size')
            .setDesc('Default font size for the text tool.')
            .addSlider(sl => {
                sl.setLimits(8, 72, 2)
                    .setValue(this.plugin.settings.textSize || 16)
                    .setDynamicTooltip()
                    .onChange(async v => { this.plugin.settings.textSize = v; await this.plugin.saveSettings(); });
            });

        // ── Input & Touch Check ──────────────────────────────
        el.createEl('h3', { text: '✋ Touch & Input' });
        new Setting(el)
            .setName('Allow drawing with fingers')
            .setDesc('When disabled, only a pen or mouse can draw. Fingers will only be used for scrolling. (Recommended for laptop/tablet users with pen).')
            .addToggle(tg => tg
                .setValue(this.plugin.settings.allowTouch)
                .onChange(async v => {
                    this.plugin.settings.allowTouch = v;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(el)
            .setName('Pen side button tool')
            .setDesc('Which tool should be used while holding the pen side button? (Requires Pen support).')
            .addDropdown(dd => {
                dd.addOption('eraser', '🧽 Eraser')
                .addOption('select', '🏹 Select / Move')
                .addOption('lasso', '◌ Lasso Selection')
                .addOption('snip', '✂️ Snip Tool')
                .addOption('rect', '⬜ Rectangle')
                .addOption('circle', '⭕ Circle')
                .addOption('line', '📏 Line')
                .addOption('arrow', '➡️ Arrow')
                .addOption('text', '✍️ Text')
                .setValue(this.plugin.settings.penSideButtonTool || 'eraser')
                .onChange(async v => {
                    this.plugin.settings.penSideButtonTool = v;
                    await this.plugin.saveSettings();
                });
            });

        // ── Toolbar Support ────────────────────────────────────
        el.createEl('h3', { text: '🛠️ Toolbar Customization' });
        const toolMap = {
            'nav': '◀▶ Navigation (prev / next page)',
            'zoom': '🔍 Zoom buttons',
            'scroll': '✋ Scroll / Hand',
            'select': '🏹 Select / Pointer',
            'lasso': '◌ Lasso Tool',
            'pen': '✏️ Pen',
            'eraser': '⬛ Eraser',
            'text': '✍️ Text Tool',
            'image': '🖼️ Image Tool',
            'snip': '✂️ Snip Tool',
            'paste': '📋 Paste Button',
            'delete': '❌ Delete Button (when selected)',
            'rect': '▭ Rectangle',
            'circle': '○ Ellipse',
            'line': '╱ Line',
            'arrow': '→ Arrow',
            'undo': '↩ Undo',
            'zen': '⛶ Zen Mode',
            'insert': '📄 Insert Page',
            'remove': '🗑 Delete Page',
            'save': '💾 Save Annotations',
            'flatten': '🔥 Flatten PDF'
        };

        Object.entries(toolMap).forEach(([id, name]) => {
            new Setting(el)
                .setName(name)
                .addToggle(tg => tg
                    .setValue(this.plugin.settings.enabledTools.includes(id))
                    .onChange(async v => {
                        if (v) {
                            if (!this.plugin.settings.enabledTools.includes(id)) this.plugin.settings.enabledTools.push(id);
                        } else {
                            this.plugin.settings.enabledTools = this.plugin.settings.enabledTools.filter(t => t !== id);
                        }
                        await this.plugin.saveSettings();
                        // Refresh all open PDF views to reflect toolbar changes
                        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
                            if (leaf.view instanceof PdfNotesView) {
                                leaf.view.buildUI();
                                if (leaf.view.pdfDoc) leaf.view.rebuildAll();
                            }
                        });
                    }));
        });

        el.createEl('h3', { text: '✨ Toolbar Layout' });
        new Setting(el)
            .setName('Toolbar position')
            .setDesc('Choose where to place the toolbars.')
            .addDropdown(dd => {
                dd.addOption('top', 'Top')
                    .addOption('right', 'Right Side')
                    .setValue(this.plugin.settings.toolbarPosition || 'top')
                    .onChange(async v => {
                        this.plugin.settings.toolbarPosition = v;
                        await this.plugin.saveSettings();
                        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
                            if (leaf.view instanceof PdfNotesView) {
                                leaf.view.buildUI();
                                if (leaf.view.pdfDoc) leaf.view.rebuildAll();
                            }
                        });
                    });
            });

        el.createEl('h3', { text: '🎨 Icon Style' });

        // ── Icon Customization ────────────────────────────────────
        const emojiSection = el.createDiv();
        emojiSection.style.display = (this.plugin.settings.iconType || 'lucide') === 'emoji' ? 'block' : 'none';

        new Setting(el)
            .setName('Icon style')
            .setDesc('Lucide uses clean vector icons. Emoji lets you assign custom symbols to each tool.')
            .addDropdown(dd => {
                dd.addOption('lucide', '🔷 Lucide Icons')
                    .addOption('emoji', '😀 Emoji / Custom Symbols')
                    .setValue(this.plugin.settings.iconType || 'lucide')
                    .onChange(async v => {
                        this.plugin.settings.iconType = v;
                        await this.plugin.saveSettings();
                        emojiSection.style.display = v === 'emoji' ? 'block' : 'none';
                        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
                            if (leaf.view instanceof PdfNotesView) {
                                leaf.view.buildUI();
                                if (leaf.view.pdfDoc) leaf.view.rebuildAll();
                            }
                        });
                    });
            });
        
        emojiSection.createEl('h3', { text: '🎨 Toolbar Icons' });
        emojiSection.createEl('p', { text: 'Choose which symbol/emoji is displayed for each tool in the toolbar. Select a preset or enter your own custom symbol.', cls: 'setting-item-description' });

        const iconPresets = {
            scroll: ['✋', '🤚', '👆', '🖐️', '☝️', '📜'],
            select: ['🖱️', '👆', '🎯', '➤', '🔍', '☝️'],
            lasso: ['🎯', '◌', '⭕', '🔲', '📐', '🪢'],
            pen: ['✏️', '🖊️', '🖋️', '✍️', '📝', '🔵'],
            eraser: ['⬛', '🧽', '🗑️', '🚫', '✖️', '🔲'],
            text: ['T', '✍️', '📝', 'A', '🔤', '💬'],
            image: ['🖼️', '📷', '🏞️', '📸', '🎨', '🖻'],
            snip: ['✂️', '📐', '🔲', '⬛', '📏', '🖼️'],
            paste: ['📋', '📌', '📎', '🗒️', '📄', '➕'],
            delete: ['❌', '🗑️', '✖️', '🚫', '⛔', '💣'],
            rect: ['▭', '⬜', '🔲', '◻️', '□', '▢'],
            circle: ['○', '⭕', '◯', '🔵', '⚪', '●'],
            line: ['╱', '📏', '─', '—', '/', '➖'],
            arrow: ['→', '➡️', '⤴️', '↗️', '►', '➜']
        };

        if (!this.plugin.settings.toolIcons) this.plugin.settings.toolIcons = { ...DEFAULT_SETTINGS.toolIcons };

        Object.entries(toolMap).forEach(([id, name]) => {
            const currentIcon = this.plugin.settings.toolIcons[id] || DEFAULT_SETTINGS.toolIcons[id] || '?';
            const presets = iconPresets[id] || [];
            const isCustom = !presets.includes(currentIcon);

            const row = new Setting(emojiSection)
                .setName(name.split(' ').slice(1).join(' '))  // strip leading emoji from name
                .setDesc(`Current: ${currentIcon}`);

            // Dropdown with presets + custom option
            row.addDropdown(dd => {
                presets.forEach(p => dd.addOption(p, p));
                dd.addOption('__custom__', '✨ Custom...');
                dd.setValue(isCustom ? '__custom__' : currentIcon);
                dd.onChange(async v => {
                    if (v === '__custom__') {
                        // Show the custom text input (it's already there, just enable it)
                        const customInput = row.settingEl.querySelector('.pdf-icon-custom-input');
                        if (customInput) { customInput.style.display = ''; customInput.focus(); }
                    } else {
                        this.plugin.settings.toolIcons[id] = v;
                        await this.plugin.saveSettings();
                        row.setDesc(`Current: ${v}`);
                        // Hide custom input
                        const customInput = row.settingEl.querySelector('.pdf-icon-custom-input');
                        if (customInput) customInput.style.display = 'none';
                        // Refresh views
                        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
                            if (leaf.view instanceof PdfNotesView) {
                                leaf.view.buildUI();
                                if (leaf.view.pdfDoc) leaf.view.rebuildAll();
                            }
                        });
                    }
                });
            });

            // Custom text input
            row.addText(txt => {
                txt.inputEl.classList.add('pdf-icon-custom-input');
                txt.inputEl.style.width = '60px';
                txt.inputEl.style.textAlign = 'center';
                txt.inputEl.style.fontSize = '16px';
                txt.inputEl.placeholder = '🔥';
                txt.setValue(isCustom ? currentIcon : '');
                txt.inputEl.style.display = isCustom ? '' : 'none';
                txt.onChange(async v => {
                    if (v.trim()) {
                        this.plugin.settings.toolIcons[id] = v.trim();
                        await this.plugin.saveSettings();
                        row.setDesc(`Current: ${v.trim()}`);
                        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
                            if (leaf.view instanceof PdfNotesView) {
                                leaf.view.buildUI();
                                if (leaf.view.pdfDoc) leaf.view.rebuildAll();
                            }
                        });
                    }
                });
            });
        });

        // ── Auto-Save Section ────────────────────────────────────
        el.createEl('h3', { text: '💾 Auto-Save' });
        const asInfo = el.createDiv();
        asInfo.style.cssText = 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;font-size:12px;color:var(--text-muted);line-height:1.6;';
        asInfo.createSpan({ text: '✅ ' });
        asInfo.createEl('b', { text: 'Auto-Save is active. ' });
        asInfo.createSpan({ text: 'Drawings are automatically written into the PDF ' });
        asInfo.createEl('b', { text: '4 seconds ' });
        asInfo.createSpan({ text: 'after the last stroke.' });
        asInfo.createEl('br');
        asInfo.createSpan({ text: 'The 💾 button saves manually immediately.' });

        // ── About & Credits ──────────────────────────────────
        el.createEl('h3', { text: 'ℹ️ About & Credits' });
        const credits = el.createDiv();
        credits.style.cssText = 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;font-size:12px;color:var(--text-muted);line-height:1.6;';
        credits.createEl('b', { text: 'Version: ' });
        credits.createSpan({ text: '1.0.0 (First Release)' });
        credits.createEl('br');
        credits.createSpan({ text: 'This is the first version of PDF.notes. ' });
        credits.createEl('b', { text: 'Feedback and criticism are highly welcome' });
        credits.createSpan({ text: ' to help improve the plugin!' });
        credits.createEl('br');
        credits.createEl('br');
        credits.createSpan({ text: 'This plugin uses ' });
        credits.createEl('b', { text: 'pdf-lib' });
        credits.createSpan({ text: ' (MIT) for PDF manipulation and ' });
        credits.createEl('b', { text: 'PDF.js' });
        credits.createSpan({ text: ' (Apache 2.0) for rendering.' });
        credits.createEl('br');
        credits.createSpan({ text: 'Special thanks to the open source community!' });

        // ── Connect ──────────────────────────────────
        el.createEl('h3', { text: '🤝 Connect with the author' });
        const social = el.createDiv();
        social.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px 14px;background:var(--background-secondary);border-radius:6px;font-size:13px;';

        const createLink = (lbl, url, icon = '🔗') => {
            const row = social.createDiv();
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.createSpan({ text: icon });
            const a = row.createEl('a', { text: lbl, href: url });
            a.style.color = 'var(--text-accent)';
            a.style.textDecoration = 'none';
        };

        createLink('Twitter / X (@DerMittlereWeg)', 'https://x.com/DerMittlereWeg', '🐦');
        createLink('Instagram (@anton0win)', 'https://www.instagram.com/anton0win/', '📸');
        createLink('Email (awincommerce@gmail.com)', 'mailto:awincommerce@gmail.com', '📧');

        const finalWarn = el.createDiv();
        finalWarn.style.cssText = 'margin-top: 25px; padding: 10px; text-align: center; border-top: 1px solid var(--background-modifier-border); color: #ff6400; font-weight: bold; font-size: 14px;';
        finalWarn.setText('⚠️ This is an early version. Use at your own risk. Feedback is welcome!');
    }
}

// ── Plugin ─────────────────────────────────────────────
class PdfNotesPlugin extends Plugin {
    async onload() {
        console.log('[PDF.notes] v1.0.0');
        this.pluginDir = nodePath.join(this.app.vault.adapter.getBasePath(), '.obsidian', 'plugins', 'pdf-notes');
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // Ensure new tools are present even if settings exist from older versions
        ['snip', 'lasso', 'select', 'nav', 'zoom', 'undo', 'zen', 'insert', 'remove', 'save', 'flatten'].forEach(t => {
            if (!this.settings.enabledTools.includes(t)) this.settings.enabledTools.push(t);
        });
        // Ensure all toolIcon defaults are present
        if (!this.settings.toolIcons) this.settings.toolIcons = { ...DEFAULT_SETTINGS.toolIcons };
        Object.entries(DEFAULT_SETTINGS.toolIcons).forEach(([k, v]) => {
            if (!this.settings.toolIcons[k]) this.settings.toolIcons[k] = v;
        });
        
        this.registerView(VIEW_TYPE, leaf => new PdfNotesView(leaf, this));
        this.addSettingTab(new PdfNotesSettingTab(this.app, this));
        this.addCommand({ id: 'open', name: 'Open active PDF with PDF.notes', callback: () => { const f = this.app.workspace.getActiveFile(); if (f?.extension === 'pdf') this.openView(f); else new Notice('No active PDF.'); } });
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => { if (file?.extension !== 'pdf') return; menu.addItem(i => i.setTitle('📝 Open with PDF.notes').setIcon('brush').onClick(() => this.openView(file))); }));
        this.addRibbonIcon('brush', 'PDF.notes', () => { const f = this.app.workspace.getActiveFile(); if (f?.extension === 'pdf') this.openView(f); else new Notice('Open a PDF first.'); });
        this.addRibbonIcon('file-plus-2', 'PDF.notes (New blank file)', () => this.createNewPdf());
    }
    async saveSettings() { await this.saveData(this.settings); }
    async openView(tFile) { const leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); const v = leaf.view; if (v instanceof PdfNotesView) { await v.setPdfFile(tFile); this.app.workspace.revealLeaf(leaf); } }
    async onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
    async createNewPdf() {
        new CreatePdfModal(this.app, this, async (filename, folderPath) => {
            if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
            const normFolder = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
            let dir = this.app.vault.getAbstractFileByPath(normFolder || '/');
            if (normFolder && !dir) {
                try {
                    // Create folder recursively if it doesn't exist
                    const parts = normFolder.split('/');
                    let cur = '';
                    for (const p of parts) {
                        cur = cur ? `${cur}/${p}` : p;
                        if (!this.app.vault.getAbstractFileByPath(cur)) {
                            await this.app.vault.createFolder(cur);
                        }
                    }
                } catch (e) {
                    console.error('[PDF.notes] Error creating folder:', e);
                }
            }

            let fullPath = normFolder ? `${normFolder}/${filename}` : filename;
            try {
                const pdfLib = PDFLib;
                const doc = await pdfLib.PDFDocument.create();
                const page = doc.addPage([595.28, 841.89]);
                page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: pdfLib.rgb(1, 1, 1), opacity: 1 });
                const bytes = await doc.save();

                let checkPath = fullPath;
                let baseName = filename.replace(/\.pdf$/i, '');
                let ext = '.pdf';
                let i = 1;
                while (this.app.vault.getAbstractFileByPath(checkPath)) {
                    checkPath = normFolder ? `${normFolder}/${baseName} ${i++}${ext}` : `${baseName} ${i++}${ext}`;
                }

                const file = await this.app.vault.createBinary(checkPath, bytes);
                new Notice('📄 New PDF created: ' + checkPath);
                this.openView(file);
            } catch (e) {
                console.error('[PDF.notes] Error creating new PDF:', e);
                new Notice('❌ Error creating new PDF');
            }
        }).open();
    }
}

module.exports = PdfNotesPlugin;
