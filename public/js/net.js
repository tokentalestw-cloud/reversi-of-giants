// WebSocket 連線（支援手機切換 App 背景自動重連與房間保留）
function getClientId() {
  try {
    let id = localStorage.getItem('rog_cid');
    if (!id) {
      id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
      localStorage.setItem('rog_cid', id);
    }
    return id;
  } catch {
    return 'cid_' + Math.random().toString(36).slice(2, 12);
  }
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.cid = getClientId();
    this.roomCode = null;
    this.manualClose = false;
    this.queue = [];
    this._reconnTimer = null;

    this._onVisible = () => {
      if (document.visibilityState === 'visible' && !this.manualClose && this.roomCode) {
        if (!this.ws || this.ws.readyState > 1) {
          this._reconnectNow();
        } else if (this.ws.readyState === 1) {
          // 切回前景時主動同步一次房間狀態（以防在 LINE 期間朋友已加入或落子）
          this.send({ t: 'rejoin', code: this.roomCode, cid: this.cid });
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisible);
    window.addEventListener('focus', this._onVisible);
    window.addEventListener('pageshow', this._onVisible);
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

  connect() {
    this.manualClose = false;
    return this._openSocket(true);
  }

  _openSocket(isInitial = false) {
    return new Promise((resolve, reject) => {
      if (location.protocol === 'file:') {
        reject(new Error('請透過伺服器網址開啟遊戲才能連線'));
        return;
      }
      clearTimeout(this._reconnTimer);
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      const ws = this.ws = new WebSocket(url);
      let opened = false;

      ws.onopen = () => {
        opened = true;
        clearInterval(this._ping);
        this._ping = setInterval(() => this.send({ t: 'ping' }), 15000);
        // 若是重連且已有房間代碼，自動送出 rejoin
        if (!isInitial && this.roomCode) {
          ws.send(JSON.stringify({ t: 'rejoin', code: this.roomCode, cid: this.cid }));
        }
        while (this.queue.length && ws.readyState === 1) {
          ws.send(JSON.stringify(this.queue.shift()));
        }
        resolve();
      };

      ws.onerror = () => {
        if (!opened && isInitial) reject(new Error('無法連線到伺服器'));
      };

      ws.onclose = () => {
        clearInterval(this._ping);
        if (this.manualClose) return;
        if (this.roomCode) {
          // 手機切換 App 導致背景斷線：自動重連，絕不直接跳回大廳
          this._scheduleReconnect();
        } else if (opened) {
          this.handlers.close?.();
        }
      };

      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.code) this.roomCode = m.code;
        this.handlers[m.t]?.(m);
      };
    });
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnTimer);
    this._reconnTimer = setTimeout(() => {
      if (!this.manualClose && this.roomCode && (!this.ws || this.ws.readyState > 1)) {
        this._openSocket(false).catch(() => this._scheduleReconnect());
      }
    }, 1000);
  }

  _reconnectNow() {
    clearTimeout(this._reconnTimer);
    this._openSocket(false).catch(() => this._scheduleReconnect());
  }

  send(obj) {
    const payload = { ...obj, cid: this.cid };
    if (obj.code) this.roomCode = obj.code;
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(payload));
    } else if (!this.manualClose && obj.t !== 'ping') {
      this.queue.push(payload);
      if (this.roomCode) this._reconnectNow();
    }
  }

  leaveAndClose() {
    this.manualClose = true;
    this.roomCode = null;
    clearTimeout(this._reconnTimer);
    clearInterval(this._ping);
    document.removeEventListener('visibilitychange', this._onVisible);
    window.removeEventListener('focus', this._onVisible);
    window.removeEventListener('pageshow', this._onVisible);
    if (this.ws) {
      if (this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify({ t: 'leave', cid: this.cid })); } catch {}
      }
      this.handlers = {};
      this.ws.close();
      this.ws = null;
    }
  }

  close() {
    this.leaveAndClose();
  }
}
