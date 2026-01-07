export class ChatRoom {
  constructor(state) {
    this.state = state;
    this.sessions = new Map();
    this.messages = [];
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected websocket", { status: 400 });
    }
    
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    this.state.acceptWebSocket(server);
    server.accept();
    
    const session = { ws: server, name: null, blockedMessages: [] };
    this.sessions.set(server, session);
    
    if (this.messages.length === 0) {
      this.messages = await this.state.storage.get('messages') || [];
    }
    
    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'username') {
          session.name = data.name;
          server.send(JSON.stringify({type: 'history', messages: this.messages}));
          session.blockedMessages.forEach(msg => server.send(msg));
          session.blockedMessages = [];
          this.broadcast({type: 'join', name: session.name});
        } else if (data.type === 'changeUsername') {
          session.name = data.name;
          this.broadcast({type: 'rename', oldName: 'Someone', newName: data.name});
        } else if (data.type === 'message') {
          const msg = {username: session.name, message: data.message, timestamp: Date.now()};
          this.messages.push(msg);
          await this.state.storage.put('messages', this.messages);
          this.broadcast({type: 'chat', ...msg});
        }
      } catch(e) {}
    });

    server.addEventListener('close', () => {
      if (session.name) this.broadcast({type: 'leave', name: session.name});
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message) {
    const msgStr = JSON.stringify(message);
    this.sessions.forEach((session, ws) => {
      try {
        if (session.name) ws.send(msgStr);
        else session.blockedMessages.push(msgStr);
      } catch(e) {
        this.sessions.delete(ws);
      }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/chat' && request.headers.get('upgrade') === 'websocket') {
      const id = env.CHAT_ROOM.idFromName('friends-room');
      const chatObj = env.CHAT_ROOM.get(id);
      return chatObj.fetch(request);
    }
    return new Response(`Chat: wss://${url.host}/chat`, {status: 200});
  },
};
