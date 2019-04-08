import EventEmitter from 'events';
import zmq from 'zeromq';

import bitcoinjs, {Block} from 'bitcoinjs-lib';

export interface PoolLog {
  block: Block,
  poolTimes: number[]
}

export interface Storage {
  write(p: PoolLog): Promise<void>
}

export class Bademeister {
  public sock: zmq.Socket;
  public mempool: Map<string, Date> = new Map();

  constructor(url: string, public storage: Storage) {
    this.sock = zmq.socket('sub');
    console.log(`connecting to ${url}`);
    this.sock.connect(url);
    this.sock.subscribe('hashtx');
    this.sock.subscribe('rawblock');
    console.log('subscribed to zmq feeds');
    this.sock.on('message', (topic, message) => {
      topic = topic.toString();
      switch (topic) {
        case 'hashtx':
          this.addMempool(message);
          break;
        case 'rawblock':
          this.addBlock(message);
          break;
        default:
          throw new Error(`unknown topic ${topic}`)
      }
    })
  }

  public addMempool(txHash: Buffer) {
    const id = txHash.toString('hex');
    if (this.mempool.has(id)) {
      console.warn(`already seen ${id}`);
      return;
    }
    console.log(`adding ${id} mempool.size=${this.mempool.size}`);
    this.mempool.set(id, new Date());
  }

  public getAges(now: Date = new Date()): Map<string, number> {
    return new Map(
      [...this.mempool.entries()].map(([k, v]): [string, number] =>
        [k, now.getTime() - v.getTime()]
      )
    );
  }

  public addBlock(buf: Buffer) {
    const block = Block.fromBuffer(buf);
    const blockDate = block.getUTCDate();

    if (!block.transactions) {
      console.warn(`block ${block.getId()} has no transactions`);
      return;
    }

    const poolTimes = block.transactions!.map((tx): number => {
      const txSeen = this.mempool.get(tx.getId());
      this.mempool.delete(tx.getId());
      if (!txSeen) {
        return NaN;
      }

      const poolTime = blockDate.getTime() - txSeen.getTime();
      if (poolTime <= 0) {
        return NaN;
      }

      return poolTime;
    });

    this.storage.write({ block, poolTimes });
  }
}
