import { generateTemplateIdentifier, parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { writeFileSync } from 'node:fs';
import { layawayJarTemplate } from '../source/index.js';

const parsed = parseTemplate(layawayJarTemplate);
const identifier = generateTemplateIdentifier(parsed);
writeFileSync(new URL('../fixtures/layaway-jar.template.json', import.meta.url), `${serializeTemplate(parsed)}\n`);
console.log('TEMPLATE_IDENTIFIER', identifier);
console.log('ACTIONS', Object.keys(parsed.actions).join(','));
console.log('WROTE', 'fixtures/layaway-jar.template.json');
