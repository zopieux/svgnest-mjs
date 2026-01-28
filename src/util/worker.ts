import { placePaths } from '../placement-logic.js';
import { calculateNFP } from '../nfp-logic.js';

if (typeof self !== 'undefined') {
  self.onmessage = function (e: MessageEvent) {
    const { type, data, id } = e.data;

    try {
      let result;
      if (type === 'nfp') {
        result = calculateNFP(data);
      } else if (type === 'place') {
        result = placePaths(data);
      } else {
        throw new Error('Unknown message type: ' + type);
      }
      self.postMessage({ id, result });
    } catch (err: any) {
      console.error(err);
      self.postMessage({ id, error: err.message });
    }
  };
}
