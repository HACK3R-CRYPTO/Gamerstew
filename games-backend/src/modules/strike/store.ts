// ─── Where rooms are kept ────────────────────────────────────────────────────
// The rules (service.ts) never touch a Map directly: they go through this
// interface. Today the only implementation keeps rooms in this process's
// memory, which is right for one server.
//
// What it will take to run several servers, honestly: a Redis class against
// this interface is necessary but NOT sufficient. The service reads a room,
// changes it and writes it back, and `get` here hands back the live object, so
// today that is atomic. A store that returns copies needs each change wrapped
// in a per-room lock or a compare-and-set, or one phone's poll will overwrite
// another phone's roll. That is the work to do at that point.

/** One throw as the player released it: which tyre, where from, the angle, how hard, how much curve. */
export interface Throw { tyre: string; x: number; angle: number; speed: number; spin: number }
export interface Player { name: string; token: string; rolls: number[]; done: boolean; seen: number; left: boolean; /** every throw of this round, in order: enough to replay the whole card on another screen */ throws?: Throw[] }
/** One line of room chat. `seat` is who said it. */
export interface ChatLine { id: number; seat: number; name: string; text: string; at: number }
export interface Room { code: string; status: 'waiting' | 'playing' | 'over'; round: number; touched: number; players: Player[]; /** a second, public name for the room: it lets anyone watch and can never be used to join */ watch?: string; /** the last lines of talk between the players in this lane */ chat?: ChatLine[] }

export interface RoomStore {
  get(code: string): Promise<Room | undefined>;
  /** create or replace */
  put(room: Room): Promise<void>;
  delete(code: string): Promise<void>;
  count(): Promise<number>;
  all(): Promise<Room[]>;
  /** drop every room not touched since `olderThan` (ms epoch) */
  sweep(olderThan: number): Promise<void>;
}

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();
  async get(code: string) { return this.rooms.get(code); }
  async put(room: Room) { this.rooms.set(room.code, room); }
  async delete(code: string) { this.rooms.delete(code); }
  async count() { return this.rooms.size; }
  async all() { return [...this.rooms.values()]; }
  async sweep(olderThan: number) {
    for (const [code, r] of this.rooms) if (r.touched < olderThan) this.rooms.delete(code);
  }
}
