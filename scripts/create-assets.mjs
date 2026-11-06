import fs from 'node:fs/promises';
import sharp from 'sharp';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SquaresFour, Files, ChatCircleDots, EnvelopeSimple, Code } from '@phosphor-icons/react';
import * as icons from 'simple-icons';

await fs.mkdir('public/icons', { recursive: true });
await fs.mkdir('public/preview-icons', { recursive: true });
const symbol = renderToStaticMarkup(React.createElement(SquaresFour, { size: 84, weight: 'fill', color: '#f5f6f3' }));
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="32" fill="#41674e"/><svg x="22" y="22" width="84" height="84">${symbol.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></svg>`;
for (const size of [16, 48, 128]) await sharp(Buffer.from(logo)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);

const brands = { github: 'siGithub', figma: 'siFigma', notion: 'siNotion', mdn: 'siMdnwebdocs', v2ex: 'siV2ex', youtube: 'siYoutube', typescript: 'siTypescript', react: 'siReact', stack: 'siStackoverflow', wiki: 'siWikipedia', chrome: 'siGooglechrome' };
for (const [file, name] of Object.entries(brands)) {
  const icon = icons[name];
  const color = ['github', 'notion', 'mdn', 'wiki', 'v2ex'].includes(file) ? '414B44' : icon.hex;
  await fs.writeFile(`public/preview-icons/${file}.svg`, icon.svg.replace('<svg ', `<svg fill="#${color}" `));
}
for (const [name, Icon, color] of [['files', Files, '#587fa4'], ['chatgpt', ChatCircleDots, '#328c70'], ['mail', EnvelopeSimple, '#b85b4c'], ['code', Code, '#5378aa'], ['sspai', SquaresFour, '#b65350']]) {
  await fs.writeFile(`public/preview-icons/${name}.svg`, renderToStaticMarkup(React.createElement(Icon, { size: 64, weight: 'fill', color })));
}
console.log('Created extension icons and local preview icons.');
