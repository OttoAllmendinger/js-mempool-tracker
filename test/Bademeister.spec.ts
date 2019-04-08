import _ from 'lodash';
import 'mocha';
import 'should';

import Bluebird from 'bluebird';

import fs from 'fs-extra';

// @ts-ignore
import RpcClient from 'bitcoind-rpc';

import { ChildProcess, execFile, spawn, SpawnOptions } from "child_process";
import {Bademeister, PoolLog} from "../src/Bademeister";
import * as os from "os";
import {promisify} from "util";
import assert from "assert";

/**
 * @return promisified rpc connection to the bitcoind node.
 */
export const getBitcoindRpc = (
  { host, port, user, pass }: {
    host: string,
    port: string,
    user: string,
    pass: string,
  }
): any => {
  const client = new RpcClient({
    protocol: 'http',
    host,
    port,
    user,
    pass,
  });

  // promsify all methods of RpcClients so that we can use them with `await`
  const result: { [func: string]: (...args: any[]) => Promise<any> } = {};
  for (const prop of Object.keys(RpcClient.callspec)) {
    if (_.isFunction(client[prop])) {
      result[prop as any as string] = async (...args): Promise<any> => {
        const { result, error } = await promisify(client[prop].bind(client))(...args);
        if (error !== null) {
          throw new Error(`error in ${prop}: ${error}`);
        }
        return result;
      }
    }
  }
  return result;
};

describe('Bademeister', function () {
  const zmqUrl = 'tcp://127.0.0.1:28334';
  const rpcPort = `18333`;

  let bitcoindRegnetProcess: ChildProcess;
  let bitcoinRpcClient: any;
  // let jaysonClient: Client;
  let dataDir: string;
  // let dataDir: string = `${process.env.HOME}/tmp/bademeister0/`;

  before(async function () {
    this.timeout(10_000);

    // dataDir = await fs.mkdtemp(os.tmpdir() + '/bademeister-');
    dataDir = '/tmp/bademeister0';
    const args = [
      '-regtest=1',
      `-datadir=${dataDir}`,
      '-rpcallowip=127.0.0.1',
      `-rpcbind=127.0.0.1:${rpcPort}`,
      `-zmqpubrawtx=${zmqUrl}`,
      `-zmqpubrawblock=${zmqUrl}`,
      `-zmqpubhashtx=${zmqUrl}`,
      `-zmqpubhashblock=${zmqUrl}`,
    ];
    console.log(args.join('\n   '));
    bitcoindRegnetProcess = spawn('bitcoind', args, { stdio: "ignore" });
    console.log(`bitcoind started with dataDir=${dataDir} pid=${bitcoindRegnetProcess.pid}`);

    await Bluebird.delay(1_000);

    const cookie =
      (await fs.readFile(`${dataDir}/regtest/.cookie`))
      .toString()
      .trim();

    const [user, pass] = cookie.split(':');

    bitcoinRpcClient = getBitcoindRpc({
      user,
      pass,
      host: '127.0.0.1',
      port: rpcPort,
    });

    /*
    jaysonClient = Client.http({
      host: '127.0.0.1',
      port: rpcPort,
      headers: {
        Authorization: `Basic ${(new Buffer(cookie)).toString('base64')}`
      }
    });
    */
  });

  after(async function () {
    console.log(`shutting down bitcoind...`);
     if (!bitcoindRegnetProcess) {
      throw new Error(`failed to start process`)
    }
    bitcoindRegnetProcess.kill('SIGINT');
    console.log(`bitcoind killed=${bitcoindRegnetProcess.killed}`);

    if (!dataDir.startsWith(`/tmp/`)) {
      throw new Error(`invalid datadir`)
    }
    await fs.remove(dataDir);
  });

  it('watches the mempool', async function () {
    this.timeout(10 * 60_000);
    const logs: PoolLog[] = [];
    const bademeister = new Bademeister(zmqUrl, {
      async write(log): Promise<void> {
        logs.push(log);
      }
    });

    const address = await bitcoinRpcClient.getNewAddress();
    console.log(`address=${address}`);

    console.log('generate()...');
    await bitcoinRpcClient.generate(101);
    await Bluebird.delay(100);
    logs.length.should.eql(101);

    logs.splice(0);

    const pause = 200;
    const txIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      console.log(`sendToAddress() ${i}...`);
      const txId = await bitcoinRpcClient.sendToAddress(address, i);
      txIds.push(txId);
      await Bluebird.delay(pause);
      bademeister.mempool.has(txId);
      const ageMS = (new Date().getTime()) - bademeister.mempool.get(txId)!.getTime();
      ageMS.should.be.approximately(pause, 20);
    }
    await bitcoinRpcClient.generate(1);
    await Bluebird.delay(100);
    logs.length.should.eql(1);
    const [{ block, poolTimes }] = logs;

    const getPoolTime = (txId: string): number => {
      const t = poolTimes.find((t, i) => block.transactions![i].getId() === txId);
      assert(t !== undefined);
      return t!;
    };

    [0, 1, 2, 3].forEach((i) =>
      (getPoolTime(txIds[i]) - getPoolTime(txIds[i + 1]))
        .should.be.approximately(pause, 20)
    );

    debugger;
  })
});
