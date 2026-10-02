import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleTastePresets, deleteTastePreset } from '../src/app/lib/theme-preset-library';
import { USER_DEFAULT_UI_SETTINGS_KEY, TITLE_FONT_OPTIONS, resolveTitleFontStack, defaultSettings } from '../src/app/lib/ui-settings';
test('preset list retains saved colors and deletion across fresh reads', () => {
  const values = new Map<string,string>();
  const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:()=>true}});
  try {
    values.set(USER_DEFAULT_UI_SETTINGS_KEY+'_small',JSON.stringify({preset:'lila-rose',tableHeaderBg:'#c5d9e8',accent:'#123456',tableRadius:'20px'}));
    const initial=getVisibleTastePresets();
    assert.equal(initial.find(p=>p.id==='lila-rose')?.tableHeaderBg,'#c5d9e8');
    assert.equal(initial.find(p=>p.id==='default')?.accent,'#123456');
    assert.ok(initial.every(p=>p.tableRadius==='0px'));
    for (const removedId of ['breeze-blue', 'dream-state', 'espresso-blush', 'systematic']) {
      assert.ok(!initial.some(p => p.id === removedId), `${removedId} should be removed`);
    }
    for (const addedId of ['opal-garden', 'opal-walnut', 'dido-dreamcore', 'pastel-cocoa', 'pastel-blossom', 'pastel-powder']) {
      assert.ok(initial.some(p => p.id === addedId), `${addedId} should be present`);
    }
    assert.equal(defaultSettings.titleFontIncludeInitial, false);
    for (const fontId of ['Voyage', 'Tanamera', 'Grandstand', 'Roulen Atelier', 'Anthelion', 'Noradya', 'Athene Voyage']) {
      assert.ok(TITLE_FONT_OPTIONS.some(f => f.id === fontId), `${fontId} should be in TITLE_FONT_OPTIONS`);
      assert.match(resolveTitleFontStack(fontId), new RegExp(fontId));
    }
    deleteTastePreset('ss26');
    assert.ok(!getVisibleTastePresets().some(p=>p.id==='ss26'));
    assert.equal(getVisibleTastePresets().length,initial.length-1);
  } finally {
    if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else Reflect.deleteProperty(globalThis,'localStorage');
    if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');
  }
});
