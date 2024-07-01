import { get } from "lodash-es";
import { ISocketIO } from "../types";

/**
 * The wrapper of socket io in server side
 */
export class SocketServer<TActions> {
  constructor(private io: ISocketIO, private actions: TActions) {
    io.on("connection", (socket) => {
      socket.on("message", async (value: any) => {
        const { name, args = [], requestId } = value;

        const handle = get(this.actions, name);
        if (handle) {
          const result = await handle(...args);
          socket.send({ result, requestId });
        }
      });
    });
  }
}
