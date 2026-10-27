import { parentPort, workerData } from 'node:worker_threads';
import {adapter} from './formats.mjs';
const {scanFile,selectedFile}=adapter(workerData.format);
try { parentPort.postMessage({ ok:true, result:workerData.action==='scan' ? scanFile(workerData.path) : selectedFile(workerData.path,workerData.conversationId,workerData.leaf) }); }
catch(error) { parentPort.postMessage({ ok:false, code:error.code || 'invalid_export', message:error.message }); }
