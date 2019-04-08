/*
If you have bitcoin running somewhere else
ssh REMOTE_HOST \
  -L18332:localhost:18332 \
  -L28332:localhost:28332
*/


import {Bademeister} from "../src/Bademeister";


(async () => {
  const bademeister = new Bademeister('tcp://localhost:28332', {
    async write({ block, poolTimes }) {
      console.log({ block, poolTimes });
    }
  });
})()
  .catch((err) => {
    console.error(err);
    process.abort();
  });
