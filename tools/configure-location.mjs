import {homedir} from 'node:os';
import {locationFile,saveLocation} from '../plugin/src/location.mjs';
const dataDir=process.argv[2],profile=process.argv[3]||'desktop';if(!dataDir)throw Error('Pass an absolute data directory');
saveLocation(locationFile(process.env,homedir(),profile),{dataDir});console.log('PLUGIN_STARTUP_LOCATION_SAVED');
