import {Bademeister, PoolLog, Storage} from "../src/Bademeister";

import yargs from 'yargs';
import fs from 'fs-extra';

class FileWriter implements Storage {
  async write(l: PoolLog) {
    const id = l.block.getId();
    const filename = `seen-${l.block.getId()}.json`;
    const data = JSON.stringify(l.poolTimes.map((n) => Math.floor(n/1000)));
    await fs.writeFile(filename, data);
    console.log(`written ${filename}`);
  }
}

(async () => {
  const { argv } = yargs.option('zmqurl', { default: 'tcp://localhost:28332' });
  const bm = new Bademeister(argv.zmqurl, new FileWriter());
})();
