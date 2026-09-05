import { WORLD_CATALOG } from '../data/v2-world-catalog.mjs';
import { escapeHTML as esc, giftCount } from '../data/v2-home.mjs';
const star = '<path d="M0-24 7-8 25-7 12 6 16 24 0 14-16 24-12 6-25-7-7-8Z"/>';
const flower = '<path d="M0 0Q-10 25 0 48M0 30Q-28 10-22 35Q-9 41 0 36" fill="none" stroke="#86ad95" stroke-width="5"/><g><circle cy="-17" r="13"/><circle cx="16" cy="-5" r="13"/><circle cx="10" cy="14" r="13"/><circle cx="-10" cy="14" r="13"/><circle cx="-16" cy="-5" r="13"/><circle r="9" fill="#ffe7a5"/></g>';
export const ELEMENT_SHAPES = Object.freeze({
  star, flower,
  sun: '<circle r="38"/><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M0-52V-62M0 52V62M52 0H62M-52 0H-62M37-37 44-44M-37 37-44 44M37 37 44 44M-37-37-44-44"/></g>',
  cloud: '<path d="M-75 15C-99-15-67-42-43-27C-29-75 36-72 43-27C87-52 109 14 69 25H-55Q-67 25-75 15Z"/>',
  tree: '<path d="M-7 0H7V90H-7Z" fill="#c6a69c"/><circle cy="-45" r="53"/><circle cx="-30" cy="-10" r="37"/><circle cx="30" cy="-10" r="37"/>',
  butterfly: '<path d="M0 0C-55-63-68 22-9 14C-59 23-20 69 0 20C20 69 59 23 9 14C68 22 55-63 0 0Z"/><path d="M0 0V22M0 3-10-13M0 3 10-13" fill="none" stroke="#827290" stroke-width="3"/>',
  crystal: '<path d="M0-55 25-25 19 23 0 38-23 21-28-22Z"/><path d="M0-55 6-20 0 38-8-18Z" fill="#fff" opacity=".4"/>',
  crown: '<path d="M-40 14-44-28-20-8 0-39 20-8 44-28 40 14Z"/><path d="M-38 7H38" stroke="#fff3cb" stroke-width="7"/>',
  bracelet: '<ellipse rx="14" ry="8" fill="none" stroke="currentColor" stroke-width="8"/><circle cy="-9" r="5" fill="#fff2bd"/>',
  necklace: '<path d="M-30-6Q0 38 30-6" fill="none" stroke="currentColor" stroke-width="5"/><circle cy="18" r="7" fill="#ffe3a5"/>',
  wand: `<path d="M0 0 20 95" stroke="currentColor" stroke-width="7"/>${star}`,
  bow: '<path d="M0 0Q-55-44-40 12Q-44 43 0 8Q44 43 40 12Q55-44 0 0Z"/><circle cy="4" r="8" fill="#fbe0ed"/>',
  rainbow: '<g fill="none" stroke-width="16" opacity=".8"><path d="M-220 70A220 220 0 0 1 220 70" stroke="#e5aecb"/><path d="M-201 70A201 201 0 0 1 201 70" stroke="#f4d6ac"/><path d="M-182 70A182 182 0 0 1 182 70" stroke="#b4d6c6"/><path d="M-163 70A163 163 0 0 1 163 70" stroke="#b4c5e5"/></g>',
  castle: '<path d="M-58 30V-60H-27V-12H27V-60H58V30Z"/><path d="M-64-60-42-97-20-60M20-60 42-97 64-60" fill="#a493c7"/><path d="M-12 30V8Q0-12 12 8V30" fill="#9884b8"/><path d="M-43-48V-32M42-48V-32" stroke="#fff1c8" stroke-width="9"/>'
});
export function elementMarkup(element) {
  return `<g data-world-element="${esc(element.id)}" aria-label="${esc(element.title)}" transform="translate(${element.x} ${element.y}) scale(${element.scale})" fill="${element.color}" color="${element.color}">${ELEMENT_SHAPES[element.kind] ?? ''}</g>`;
}
export function sceneMarkup(unlocks = []) {
  const ids = new Set(unlocks.map(u => u.elementId ?? u.id));
  const owned = WORLD_CATALOG.filter(e => ids.has(e.id));
  const layer = name => owned.filter(e => e.layer === name).map(elementMarkup).join('');
  return `<svg class="magic-world" viewBox="0 0 900 600" role="img" aria-label="Волшебный мир Рамины и единорога: ${giftCount(owned.length)}">
  <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#ede5f5"/><stop offset="1" stop-color="#fff5e7"/></linearGradient><linearGradient id="dress" x2="1" y2="1"><stop stop-color="#b3a0d8"/><stop offset="1" stop-color="#e5c2e7"/></linearGradient></defs>
  <rect width="900" height="600" rx="35" fill="url(#sky)"/><ellipse cx="440" cy="635" rx="640" ry="286" fill="#dbe9d5"/><ellipse cx="768" cy="610" rx="455" ry="217" fill="#caddc7"/>
  <path d="M306 600Q533 480 425 370Q689 477 535 600" fill="#f3e5d8" opacity=".8"/>
  ${layer('background')}
  <ellipse cx="486" cy="491" rx="174" ry="25" fill="#9bafaa" opacity=".16"/>
  <g aria-label="Единорог"><path d="M504 400Q455 411 473 457" fill="none" stroke="#cdb8df" stroke-width="26" stroke-linecap="round"/>
  <path d="M520 422 511 487H529L548 426M585 422 600 487H618L607 410" fill="#fffaf4" stroke="#d7cce0" stroke-width="3"/>
  <ellipse cx="560" cy="410" rx="66" ry="45" fill="#fffaf4" stroke="#d7cce0" stroke-width="3"/>
  <path d="M577 405Q624 383 615 336L580 317Q552 359 548 392" fill="#fffaf4" stroke="#d7cce0" stroke-width="3"/>
  <path d="M607 328Q648 353 620 394Q596 355 595 331" fill="#cdb8df"/><path d="M579 292 578 251 594 288" fill="#efd19c"/>
  <path d="M582 306 550 272Q534 305 559 321" fill="#fffaf4" stroke="#d7cce0" stroke-width="3"/>
  <path d="M568 298Q611 285 624 322Q638 347 607 360L553 344Q533 334 549 318Z" fill="#fffaf4" stroke="#d7cce0" stroke-width="3"/>
  <path d="M563 324Q571 333 579 324" stroke="#81718c" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="599" cy="339" r="9" fill="#f0c3d3"/>
  <path d="M570 295Q580 275 603 291L616 320Q588 299 570 313" fill="#d3bee3"/></g>
  <g aria-label="Рамина"><path d="M340 299Q326 222 385 224Q448 223 430 332L342 350Z" fill="#54404e"/>
  <path d="M365 440 363 488M407 440 410 488" stroke="#ecc4ac" stroke-width="17" stroke-linecap="round"/>
  <path d="M348 490Q364 477 377 490M399 490Q413 477 425 490" stroke="#9e8bbd" stroke-width="12" stroke-linecap="round"/>
  <path d="M358 349 320 395M413 349 449 407" fill="none" stroke="#ecc4ac" stroke-width="16" stroke-linecap="round"/>
  <path d="M355 334Q384 320 413 334L427 360 414 367 443 451Q385 480 326 451L353 367 341 360Z" fill="url(#dress)" stroke="#b9a2d1" stroke-width="2"/>
  <path d="M368 327Q385 346 401 327" fill="#f3d0b7"/>
  <ellipse cx="384" cy="283" rx="40" ry="46" fill="#f3d0b7"/>
  <path d="M342 277Q336 225 391 232Q437 232 426 281Q403 254 373 252Q365 278 342 277" fill="#54404e"/>
  <path d="M361 285Q367 279 373 285M395 285Q401 279 407 285" stroke="#65505b" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M375 305Q385 315 395 305" stroke="#bd7f85" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="358" cy="298" rx="9" ry="5" fill="#e9aaa8"/><ellipse cx="409" cy="298" rx="9" ry="5" fill="#e9aaa8"/>
  <path d="M357 373Q385 384 413 373" stroke="#f9e6f5" stroke-width="6" fill="none"/></g>
  ${layer('foreground')}</svg>`;
}
