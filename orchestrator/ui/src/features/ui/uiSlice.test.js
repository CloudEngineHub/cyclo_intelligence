import PageType from '../../constants/pageType';
import {
  CURRENT_PAGE_STORAGE_KEY,
  LEGACY_BT_MANAGER_PAGE,
  LEGACY_NAVIGATION_PAGE,
  MISSION_CANVAS_SESSION_STORAGE_KEY,
  persistCurrentPage,
  resolveInitialPageState,
} from './uiSlice';

const makeStorage = (initial = {}) => {
  const values = { ...initial };
  return {
    getItem: jest.fn((key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null
    )),
    setItem: jest.fn((key, value) => {
      values[key] = value;
    }),
    values,
  };
};

describe('uiSlice page session state', () => {
  test('restores a valid page from tab session storage', () => {
    const storage = makeStorage({
      [CURRENT_PAGE_STORAGE_KEY]: PageType.INFERENCE,
    });

    expect(resolveInitialPageState(storage)).toEqual({
      currentPage: PageType.INFERENCE,
      restoredPageFromSession: true,
    });
  });

  test('falls back to Home when stored page is missing or invalid', () => {
    expect(resolveInitialPageState(makeStorage())).toEqual({
      currentPage: PageType.HOME,
      restoredPageFromSession: false,
    });
    expect(resolveInitialPageState(makeStorage({
      [CURRENT_PAGE_STORAGE_KEY]: 'unknown',
    }))).toEqual({
      currentPage: PageType.HOME,
      restoredPageFromSession: false,
    });
  });

  test('persists only valid pages', () => {
    const storage = makeStorage();

    persistCurrentPage(PageType.RECORD, storage);
    persistCurrentPage('unknown', storage);
    persistCurrentPage(LEGACY_BT_MANAGER_PAGE, storage);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.values[CURRENT_PAGE_STORAGE_KEY]).toBe(PageType.RECORD);
  });

  test('migrates the legacy bt_manager page into the mapless Mission Canvas workspace', () => {
    const storage = makeStorage({
      [CURRENT_PAGE_STORAGE_KEY]: LEGACY_BT_MANAGER_PAGE,
      [MISSION_CANVAS_SESSION_STORAGE_KEY]: JSON.stringify({
        workspaceKind: 'mission',
        workspaceStage: 'authoring',
        mapName: 'factory',
      }),
    });

    expect(PageType).not.toHaveProperty('BT_MANAGER');
    expect(LEGACY_BT_MANAGER_PAGE).toBe('bt_manager');
    expect(resolveInitialPageState(storage)).toEqual({
      currentPage: PageType.MISSION_CANVAS,
      restoredPageFromSession: true,
    });
    expect(storage.values[CURRENT_PAGE_STORAGE_KEY]).toBe(PageType.MISSION_CANVAS);
    expect(JSON.parse(storage.values[MISSION_CANVAS_SESSION_STORAGE_KEY]))
      .toEqual(expect.objectContaining({
        workspaceKind: 'standalone_bt',
        workspaceStage: 'authoring',
        mapName: 'factory',
      }));
  });

  test('migrates legacy bt_manager even when its Mission Canvas session is malformed', () => {
    const storage = makeStorage({
      [CURRENT_PAGE_STORAGE_KEY]: LEGACY_BT_MANAGER_PAGE,
      [MISSION_CANVAS_SESSION_STORAGE_KEY]: '{broken json',
    });

    expect(resolveInitialPageState(storage)).toEqual({
      currentPage: PageType.MISSION_CANVAS,
      restoredPageFromSession: true,
    });
    expect(JSON.parse(storage.values[MISSION_CANVAS_SESSION_STORAGE_KEY]))
      .toEqual(expect.objectContaining({
        workspaceKind: 'standalone_bt',
      }));
  });

  test('migrates the legacy navigation page into the Mission Canvas Navigate workspace', () => {
    const storage = makeStorage({
      [CURRENT_PAGE_STORAGE_KEY]: LEGACY_NAVIGATION_PAGE,
      [MISSION_CANVAS_SESSION_STORAGE_KEY]: JSON.stringify({
        workspaceKind: 'standalone_bt',
        workspaceStage: 'authoring',
        mapName: 'factory',
      }),
    });

    expect(PageType).not.toHaveProperty('NAVIGATION');
    expect(LEGACY_NAVIGATION_PAGE).toBe('navigation');
    expect(resolveInitialPageState(storage)).toEqual({
      currentPage: PageType.MISSION_CANVAS,
      restoredPageFromSession: true,
    });
    expect(storage.values[CURRENT_PAGE_STORAGE_KEY]).toBe(PageType.MISSION_CANVAS);
    expect(JSON.parse(storage.values[MISSION_CANVAS_SESSION_STORAGE_KEY]))
      .toEqual(expect.objectContaining({
        workspaceKind: 'mission',
        workspaceStage: 'navigate',
        mapName: 'factory',
      }));
  });
});
