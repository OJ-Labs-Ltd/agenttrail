// Build entry for public/build/embed.js: binds the stylesheet text so hosts call mountKitchen(element, options) only.
import css from '../embed.css';
import {mountKitchen as mount} from './embed.js';

export const mountKitchen=(element,options)=>mount(element,options,{css});
