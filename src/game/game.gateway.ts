import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ path: '/socket.io', namespace: '/tictactoe/api', cors: { origin: '*'}}) 
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect{
  @WebSocketServer()
  server: Server;

  private activeGames: Map<string, { players: string[], gameState: any }> = new Map<string, { players: string[], gameState: any }>();
  private playerGames: Map<string, string> = new Map<string, string>();
  
  handleConnection(client: any) {
    client.emit('connected', { clientId: client.id });
  }
  handleDisconnect(client: any) {
    console.log(`Client disconnected: ${client.id}`);
    if (this.playerGames.has(client.id)) {
      const gameId = this.playerGames.get(client.id);
      
      if (!gameId) return;

      const game = this.activeGames.get(gameId);

      if (!game) return;

      game.players = game.players.filter(player => player !== client.id);
      this.playerGames.delete(client.id);

      this.server.to(gameId).emit('playerLeft', { playerId: client.id });

      if (game.players.length === 0) {
        this.activeGames.delete(gameId);
        console.log(`Game ${gameId} deleted`);
      }

      console.log(`${client.id} disconnected from game ${gameId}`);
    }
  }

  @SubscribeMessage('joinGame')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: string, gameState: any }
  ) {
    if (this.playerGames.has(client.id)) this.clearClient(client.id);

    if(data.gameId) {
      if (!this.activeGames.has(data.gameId)) {
        client.emit('gameError', { message: `No Game with ID ${data.gameId}` });
        return;
      } else {
        if (this.activeGames.get(data.gameId)!.players.length >= 2) {
          client.emit('gameError', { message: `Game with ID ${data.gameId} is full` });
          return;
        }
      }
    }

    if (!data.gameId && !data.gameState) {
      client.emit('gameError', { message: 'No GameId or GameState' });
      return;
    }
    
    const gameId = data.gameId || this.generateGame();
    const gameState = data.gameState || this.getGameState(gameId);

    if(!gameState || !gameState.state) {
      this.activeGames.delete(gameId);
      client.emit('gameError', { message: `GameState Missing ${gameId}` });
      return;
    }

    const existing = this.addPlayers(gameId, client.id, gameState);

    if (!existing) {
      client.emit('gameError', { message: `No Game with ID ${gameId}` });
      return;
    }

    this.playerGames.set(client.id, gameId);
    client.join(gameId);
    
    this.server.to(gameId).emit('initUpdate', { gameId: gameId, gameState: gameState });
  }

  @SubscribeMessage('updateGameState')
  update(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: string, gameState: any }
  ) {
    const { gameId, gameState } = data;

    if (this.playerGames.has(client.id)) {
      if (this.playerGames.get(client.id) !== gameId) {
        client.emit('gameError', { message: `Client not in game ${gameId}` });
        return;
      }
    }

    if (!this.activeGames.has(gameId)) {
      client.emit('gameError', { message: `No Game with ID ${gameId}` });
      return;
    }
    
    this.server.to(gameId).emit('update', { gameState });
  }


  private generateGame(): string {
    let gameId = (Math.floor(Math.random() * 900000) + 100000).toString();
    while (this.activeGames.has(gameId)) {
      gameId = (Math.floor(Math.random() * 900000) + 100000).toString();
    }

    this.activeGames.set(gameId, { players: [], gameState: {} });

    return gameId;
  }

  private addPlayers(gameId: string, player: string, gameState: any): boolean {
    if (!this.activeGames.has(gameId)) {
      return false;
    }

    const game = this.activeGames.get(gameId);

    if (game) {
      game.players.push(player);
      game.gameState = gameState;
    }
    return true;
  }

  private clearClient(clientId: string) {
    while (this.playerGames.has(clientId)) {
      const gameId = this.playerGames.get(clientId);
      const game = this.activeGames.get(gameId!);
      if (game) {
        if (game.players.length === 0) {
          this.activeGames.delete(gameId!);
          console.log(`Game ${gameId} deleted`);
        }
      }
      
      this.playerGames.delete(clientId);
    }
  }

  private getGameState(gameId: string): any {
    const game = this.activeGames.get(gameId);
    if (game) {
      if (!game.gameState.state) return null;
      return game.gameState;
    }
    return null;
  }
}
