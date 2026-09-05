import releaseConfig from '../release-config.js';
import {validateReleaseConfig} from '../data/v2-release.mjs';
import {startV2App} from './v2-app.mjs';
const config=validateReleaseConfig(releaseConfig,location);
startV2App(config.firebase).catch(()=>{document.getElementById('status').textContent='Не удалось подключиться. Проверьте интернет и откройте приложение снова.';});
