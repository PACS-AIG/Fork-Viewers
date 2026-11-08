/**
 * Rev 11 milestone 7: Arrange previews a browsing mode in memory (Preview and
 * Cancel never write), Use this case keeps it for the case, and the stored
 * mode comes back with the next case. A deliberate choice is stored as before.
 */
const KEY = 'pacsai.browsingMode';

describe('the browsing mode (milestone 7)', () => {
  let mod: typeof import('./browsingMode');
  let setItem: jest.SpyInstance;
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(KEY, 'append');
    mod = require('./browsingMode');
    setItem = jest.spyOn(Storage.prototype, 'setItem');
  });
  afterEach(() => setItem.mockRestore());

  it('previews a mode in memory only, and tells the listeners', () => {
    const heard = jest.fn();
    mod.subscribeBrowsingMode(heard);
    mod.previewBrowsingMode('allinone');
    expect(mod.getBrowsingMode()).toBe('allinone');
    expect(mod.storedBrowsingMode()).toBe('append');
    expect(heard).toHaveBeenCalledTimes(1);
    mod.previewBrowsingMode('nope' as never);
    mod.previewBrowsingMode('allinone');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("gives a case's own mode back to the stored one when the case ends, writing nothing", () => {
    mod.previewBrowsingMode('manual');
    mod.endCaseBrowsingMode();
    expect(mod.getBrowsingMode()).toBe('append');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('stores a deliberate choice, also of the mode already in use', () => {
    mod.previewBrowsingMode('current');
    mod.setBrowsingMode('current');
    expect(setItem).toHaveBeenCalledWith(KEY, 'current');
    expect(mod.storedBrowsingMode()).toBe('current');
    setItem.mockClear();
    mod.setBrowsingMode('current');
    expect(setItem).not.toHaveBeenCalled();
    mod.setBrowsingMode('bad' as never);
    expect(setItem).not.toHaveBeenCalled();
  });
});
