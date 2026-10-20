// WebSocket 連線
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
  }
  on(type, fn) { this.handlers[type] = fn; return this; }

  connect() {
    return new Promise((resolve, reject) => {
      if (location.protocol === 'file:') { reject(new Error('請透過 server.py 啟動的網址開啟遊戲才能連線')); return; }
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      const ws = this.ws = new WebSocket(url);
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this._ping = setInterval(() => this.send({ t: 'ping' }), 20000);
        resolve();
      };
      ws.onerror = () => { if (!opened) reject(new Error('無法連線到伺服器')); };
      ws.onclose = () => { clearInterval(this._ping); if (opened) this.handlers.close?.(); };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        this.handlers[m.t]?.(m);
      };
    });
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  close() { if (this.ws) { this.handlers = {}; this.ws.close(); this.ws = null; } }
}
