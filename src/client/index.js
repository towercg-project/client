import autobind from 'auto-bind';

import * as _ from 'lodash';
import io from 'socket.io-client';
import ioWildcard from 'socketio-wildcard';
import EventEmitter2 from 'eventemitter2';
import jsondiffpatch from 'jsondiffpatch';

const jdp = jsondiffpatch.create();

export class Client {
  constructor(url, options = {}) {
    autobind(this);

    this.options = _.cloneDeep(options);

    this.logger = this.options.logger || console;
    this.logger.debug("Constructing client.");

    this._url = url;
    this._stateIteration = 0;
    this._connected = false;
    this.eventBus = new EventEmitter2();
  }

  get connected() { return this._connected; }
  get socket() { return this._io; }
  get url() { return this._url; }
  get state() { return this._state; }
  get stateIteration() { return this._stateIteration; }

  connect() {
    this.logger.info(`Connecting to server: ${this._url}`);
    this._io = this._initializeSocket(io(this.url, _.merge({}, this.options.io || {}, { autoConnect: false })));
    this._io.connect();

    return this;
  }

  disconnect() {
    this.logger.info("Disconnecting from server.");
    this._io.close();

    return this;
  }

  invoke(name, data = {}) {
    return new Promise((resolve, reject) => {
      const id = this._generateCommandId();
      const payload = { name, id, data };

      const replyName = `reply.${id}`;
      this.socket.once(replyName, (data) => {
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data);
        }
      });

      this.options.logCommands && this.logger.debug("Command:", payload);

      this.socket.emit(`towercg-client.command`, payload);
    });
  }

  _initializeSocket(io) {
    const onevent = io.onevent;

    io.onevent = (packet) => {
      const args = packet.data || [];
      if (this.options.logPackets) {
        this.logger.info(packet.data[0], packet.data[1]);
      }
      onevent.call(io, packet);
    }

    io.on('connect', () => {
      this.logger.debug("Connected.");
      this._connected = true;
      this.eventBus.emit('towercg-client.connected');
    });

    io.on('reconnect', () => {
      this.logger.debug("Reconnected.");
      this._connected = true;
      this.eventBus.emit('towercg-client.reconnected');
    });

    io.on('disconnect', () => {
      this.logger.debug("Disconnected.");
      this._connected = false;
      this.eventBus.emit('towercg-client.disconnected');
    });

    io.on('towercg.state', (newState) => {
      const oldState = this._state;
      this.options.logStateChanges && this.logger.info("Getting full state from server.");
      this._state = newState;
      this._stateIteration += 1;

      this.eventBus.emit("towercg-client.state", { newState });
      if (oldState) {
        this.eventBus.emit("towercg-client.stateChanged", { oldState, newState });
      }
    });

    io.on('towercg.stateChanged', (diff) => {
      this.options.logStateChanges && this.logger.info("State change received.");
      const oldState = this._state;
      const newState = _.cloneDeep(oldState);
      jdp.patch(newState, diff);

      this._state = newState;
      this._stateIteration += 1;
      this.eventBus.emit("towercg-client.stateChanged", { oldState, newState, diff });
    });

    return io;
  }

  _generateCommandId() {
    const nonce = Math.floor(Math.random() * 1000000000);
    return `${this.socket.id}:${nonce}`;
  }
}
