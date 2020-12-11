import { copy } from "fs-extra";
import {
  walkScenesEvents,
  eventHasArg,
  walkSceneEvents,
} from "../helpers/eventSystem";
import compileImages from "./compileImages";
import { indexBy } from "../helpers/array";
import ggbgfx from "./ggbgfx";
import {
  hi,
  lo,
  decHex16,
  convertHexTo15BitDec,
} from "../helpers/8bit";
import compileEntityEvents from "./compileEntityEvents";
import {
  EVENT_TEXT,
  EVENT_MUSIC_PLAY,
  EVENT_END,
  EVENT_PLAYER_SET_SPRITE,
  EVENT_PALETTE_SET_BACKGROUND,
  EVENT_PALETTE_SET_UI
} from "./eventTypes";
import { projectTemplatesRoot, MAX_ACTORS, MAX_TRIGGERS, DMG_PALETTE, TMP_VAR_1, TMP_VAR_2 } from "../../consts";
import {
  dirToXDec,
  dirToYDec,
  animSpeedDec,
} from "./helpers";
import compileSprites from "./compileSprites";
import compileAvatars from "./compileAvatars";
import { precompileEngineFields } from "../helpers/engineFields";
import {
  compileBackground,
  compileBackgroundHeader,
  compileScene,
  compileSceneActors,
  compileSceneActorsHeader,
  compileSceneHeader,
  compileSceneTriggers,
  compileSceneTriggersHeader,
  compileSceneSprites,
  compileSceneSpritesHeader,
  compileSceneCollisions,
  compileSceneCollisionsHeader,
  compileSceneColors,
  compileSceneColorsHeader,
  compileSpriteSheet,
  compileSpriteSheetHeader,
  compileTileset,
  compileTilesetHeader,
  paletteSymbol,
  compilePalette,
  compilePaletteHeader,
  compileFontImage,
  compileFontImageHeader,
  compileFrameImage,
  compileFrameImageHeader,
  compileCursorImage,
  compileCursorImageHeader,
  compileEmotesImage,
  compileEmotesImageHeader,
  dataArrayToC,
  toFarPtr,
  spriteSheetSymbol,
  sceneSymbol,
} from "./compileData2";

const indexById = indexBy("id");

const NUM_MUSIC_BANKS = 30; // To calculate usable banks if MBC1

export const EVENT_START_DATA_COMPILE = "EVENT_START_DATA_COMPILE";
export const EVENT_DATA_COMPILE_PROGRESS = "EVENT_DATA_COMPILE_PROGRESS";
export const EVENT_END_DATA_COMPILE = "EVENT_END_DATA_COMPILE";

export const EVENT_MSG_PRE_VARIABLES = "Preparing variables...";
export const EVENT_MSG_PRE_STRINGS = "Preparing strings...";
export const EVENT_MSG_PRE_IMAGES = "Preparing images...";
export const EVENT_MSG_PRE_UI_IMAGES = "Preparing ui...";
export const EVENT_MSG_PRE_SPRITES = "Preparing sprites...";
export const EVENT_MSG_PRE_AVATARS = "Preparing avatars...";
export const EVENT_MSG_PRE_SCENES = "Preparing scenes...";
export const EVENT_MSG_PRE_EVENTS = "Preparing events...";
export const EVENT_MSG_PRE_MUSIC = "Preparing music...";

export const EVENT_MSG_PRE_COMPLETE = "Preparation complete";
export const EVENT_MSG_COMPILING_EVENTS = "Compiling events...";

const compile = async (
  projectData,
  {
    projectRoot = "/tmp",
    engineFields = [],
    tmpPath = "/tmp",
    progress = (_msg) => {},
    warnings = (_msg) => {},
  } = {}
) => {
  const output = {};

  if (projectData.scenes.length === 0) {
    throw new Error(
      "No scenes are included in your project. Add some scenes in the Game World editor and try again."
    );
  }

  const precompiled = await precompile(projectData, projectRoot, tmpPath, {
    progress,
    warnings,
  });

  const customColorsEnabled = projectData.settings.customColorsEnabled;

  const precompiledEngineFields = precompileEngineFields(engineFields);

  // Add UI data
  output["font_image.c"] = compileFontImage(precompiled.fontTiles);
  output["font_image.h"] = compileFontImageHeader(precompiled.fontTiles);
  output["frame_image.c"] = compileFrameImage(precompiled.frameTiles);
  output["frame_image.h"] = compileFrameImageHeader(precompiled.frameTiles);
  output["cursor_image.c"] = compileCursorImage(precompiled.cursorTiles);
  output["cursor_image.h"] = compileCursorImageHeader(precompiled.cursorTiles);
  output["emotes_image.c"] = compileEmotesImage(precompiled.emotesSprite);
  output["emotes_image.h"] = compileEmotesImageHeader(precompiled.emotesSprite);

  progress(EVENT_MSG_COMPILING_EVENTS);
  // Hacky small wait to allow console to update before event loop is blocked
  // Can maybe move some of the compilation into workers to prevent this
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Add event data
  let scriptCounter = 0;
  const eventPtrs = precompiled.sceneData.map((scene, sceneIndex) => {
    const compileScript = (
      script,
      entityType,
      entity,
      entityIndex,
      loop,
      alreadyCompiled,
    ) => {
      const script = compileEntityEvents(scriptCounter, script, {
        scene,
        sceneIndex,
        scenes: precompiled.sceneData,
        music: precompiled.usedMusic,
        sprites: precompiled.usedSprites,
        avatars: precompiled.usedAvatars,
        backgrounds: precompiled.usedBackgrounds,
        strings: precompiled.strings,
        variables: precompiled.variables,
        eventPaletteIndexes: precompiled.eventPaletteIndexes,
        labels: {},
        entityType,
        entityIndex,
        entity,
        warnings,
        loop,
        engineFields: precompiledEngineFields,
        output: alreadyCompiled || [],
      });
      output[`script_${scriptCounter}.s`] = script;
      return scriptCounter++;
    };

    const bankSceneEvents = (scene, sceneIndex) => {

      
      // // Compile start scripts for actors
      // scene.actors.forEach((actor, actorIndex) => {
      //   const actorStartScript = (actor.startScript || []).filter(
      //     (event) => event.command !== EVENT_END
      //   );
      //   compileScript(
      //     actorStartScript,
      //     "actor",
      //     actor,
      //     actorIndex,
      //     false,
      //     compiledSceneScript
      //   );
      //   compiledSceneScript.splice(-1);
      // });

      // Compile scene start script
      return compileScript(
        scene.script,
        "scene",
        scene,
        sceneIndex,
        false
      );

    };

    const bankEntityEvents = (entityType, entityScriptField = "script") => (entity, entityIndex) => {
      if(!entity[entityScriptField] || entity[entityScriptField].length <= 1) {
        return -1;
      }
      // output[`scene_${sceneIndex}_${entityType}_${entityIndex}_script_${entityScriptField}.c`] = dataArrayToC(`scene_${sceneIndex}_${entityType}_${entityIndex}_script_${entityScriptField}`, 
      //   compileScript(entity[entityScriptField], entityType, entity, entityIndex, entityScriptField === "updateScript")
      // );

      return compileScript(
        entity[entityScriptField],
        entityType,
        entity,
        entityIndex,
        entityScriptField === "updateScript"
      );
    };

    return {
      start: bankSceneEvents(scene, sceneIndex),
      playerHit1: bankEntityEvents("scene", "playerHit1Script")(scene),
      playerHit2: bankEntityEvents("scene", "playerHit2Script")(scene),
      playerHit3: bankEntityEvents("scene", "playerHit3Script")(scene),
      actors: scene.actors.map(bankEntityEvents("actor")),
      actorsMovement: scene.actors.map(bankEntityEvents("actor","updateScript")),
      actorsHit1: scene.actors.map(bankEntityEvents("actor","hit1Script")),
      actorsHit2: scene.actors.map(bankEntityEvents("actor","hit2Script")),
      actorsHit3: scene.actors.map(bankEntityEvents("actor","hit3Script")),
      triggers: scene.triggers.map(bankEntityEvents("trigger")),
    };
  });

  precompiled.usedTilesets.forEach((tileset, tilesetIndex) => {
    output[`tileset_${tilesetIndex}.c`] = compileTileset(tileset, tilesetIndex);
    output[`tileset_${tilesetIndex}.h`] = compileTilesetHeader(tileset, tilesetIndex);
  });
  
  // Add palette data
  precompiled.usedPalettes.forEach((palette, paletteIndex) => {
    const paletteData = palette.length > 0 ? palette.reduce((memo, colors) => {
      return memo.concat(
        colors.reduce((colorMemo, color) => {
          const colorVal = convertHexTo15BitDec(color);
          return colorMemo.concat([lo(colorVal), hi(colorVal)]);
        }, [])
      );
    }, []) : [0];
    output[`${paletteSymbol(paletteIndex)}.c`] = compilePalette(paletteData, paletteIndex);
    output[`${paletteSymbol(paletteIndex)}.h`] = compilePaletteHeader(paletteData, paletteIndex);
    
  });

  // Add background map data
  precompiled.usedBackgrounds.forEach((background, backgroundIndex) => {
    output[`background_${backgroundIndex}.c`] = compileBackground(background, backgroundIndex);
    output[`background_${backgroundIndex}.h`] = compileBackgroundHeader(background, backgroundIndex);
  });

  // Add sprite data
  precompiled.usedSprites.forEach((sprite, spriteIndex) => {
    output[`spritesheet_${spriteIndex}.c`] = compileSpriteSheet(sprite, spriteIndex);
    output[`spritesheet_${spriteIndex}.h`] = compileSpriteSheetHeader(sprite, spriteIndex);
  });

  // Add avatar data
  precompiled.usedAvatars.forEach((avatar, avatarIndex) => {
    output[`avatar_${avatarIndex}.c`] = dataArrayToC(`avatar_${avatarIndex}`, [].concat(
      avatar.frames,
      avatar.data
    ));
  });

  // Add scene data
  precompiled.sceneData.forEach((scene, sceneIndex) => {
    const sceneImage = precompiled.usedBackgrounds[scene.backgroundIndex];
    const collisionsLength = Math.ceil(sceneImage.width * sceneImage.height);
    const collisions = Array(collisionsLength)
      .fill(0)
      .map((_, index) => {
        return (scene.collisions && scene.collisions[index]) || 0;
      });
    const tileColorsLength = Math.ceil(sceneImage.width * sceneImage.height);
    const tileColors = Array(tileColorsLength)
      .fill(0)
      .map((_, index) => {
        return (scene.tileColors && scene.tileColors[index]) || 0;
      });
    const bgPalette = precompiled.scenePaletteIndexes[scene.id] || 0;
    const actorsPalette = precompiled.sceneActorPaletteIndexes[scene.id] || 0;
  
    output[`scene_${sceneIndex}.c`] = compileScene(scene, sceneIndex, { bgPalette, actorsPalette, color: customColorsEnabled});
    output[`scene_${sceneIndex}.h`] = compileSceneHeader(scene, sceneIndex);
    output[`scene_${sceneIndex}_collisions.c`] = compileSceneCollisions(scene, sceneIndex, collisions);
    output[`scene_${sceneIndex}_collisions.h`] = compileSceneCollisionsHeader(scene, sceneIndex);
    output[`scene_${sceneIndex}_colors.c`] = compileSceneColors(scene, sceneIndex, tileColors);
    output[`scene_${sceneIndex}_colors.h`] = compileSceneColorsHeader(scene, sceneIndex);

    if (scene.actors.length > 0) {
      output[`scene_${sceneIndex}_actors.h`] = compileSceneActorsHeader(scene, sceneIndex);
      output[`scene_${sceneIndex}_actors.c`] = compileSceneActors(scene, sceneIndex, precompiled.usedSprites, precompiled.actorPaletteIndexes);
    }
    if (scene.triggers.length > 0) {
      output[`scene_${sceneIndex}_triggers.h`] = compileSceneTriggersHeader(scene, sceneIndex);
      output[`scene_${sceneIndex}_triggers.c`] = compileSceneTriggers(scene, sceneIndex);
    }
    if (scene.sprites.length > 0) {
      output[`scene_${sceneIndex}_sprites.h`] = compileSceneSpritesHeader(scene, sceneIndex);
      output[`scene_${sceneIndex}_sprites.c`] = compileSceneSprites(scene, sceneIndex);
    }    
  });

  let startSceneIndex = precompiled.sceneData.findIndex(
    (m) => m.id === projectData.settings.startSceneId
  );

  // If starting scene is not found just use first scene
  if (startSceneIndex < 0) {
    startSceneIndex = 0;
  }

  const {
    startX,
    startY,
    startDirection,
    startMoveSpeed = "1",
    startAnimSpeed = "3",
  } = projectData.settings;

  const musicBanks = [];
  for (let i = 0; i < NUM_MUSIC_BANKS; i++) {
    musicBanks[i] = 255;
  }

  const music = precompiled.usedMusic.map((track, index) => {
    const bank = musicBanks[index % musicBanks.length];
    return {
      ...track,
      bank,
    };
  });

  let playerSpriteIndex = precompiled.usedSprites.findIndex(
    (s) => s.id === projectData.settings.playerSpriteSheetId
  );
  if (playerSpriteIndex < 0) {
    playerSpriteIndex = precompiled.usedSprites.findIndex(
      (s) => s.type === "actor_animated"
    );
  }
  if (playerSpriteIndex < 0) {
    throw new Error(
      "Player sprite hasn't been set, add it from the Game World."
    );
  }

  const startDirectionX = dirToXDec(startDirection);
  const startDirectionY = dirToYDec(startDirection);

  // Set variables len to be slightly higher than needed
  // rounding to nearest 50 vars to prevent frequent
  // changes to data_ptrs.h which would invalidate build cache
  const variablesLen = Math.max(
    (Math.ceil(precompiled.variables.length / 50) * 50) + 50
  , 500);

  output[`data_ptrs.h`] =
    `#ifndef DATA_PTRS_H\n#define DATA_PTRS_H\n\n` +
    `#include "BankData.h"\n` +
    `#include "VM.h"\n\n` +
    `#define NUM_VARIABLES ${variablesLen}\n` +
    `#define TMP_VAR_1 ${precompiled.variables.indexOf(TMP_VAR_1)}\n` + 
    `#define TMP_VAR_2 ${precompiled.variables.indexOf(TMP_VAR_2)}\n\n` + 
    `extern int start_scene_x;\n` +
    `extern int start_scene_y;\n` +
    `extern char start_scene_dir_x;\n` +
    `extern char start_scene_dir_y;\n` +
    `extern far_ptr_t start_scene;\n` +
    `extern far_ptr_t start_player_sprite;\n` +
    (customColorsEnabled ? `extern far_ptr_t start_player_palette;\n` : "") +
    `extern unsigned char start_player_move_speed;\n` +
    `extern unsigned char start_player_anim_speed;\n\n` +
    `// Engine fields\n` +
    compileEngineFields(engineFields, projectData.engineFieldValues, true) + '\n' +
    `extern unsigned char script_variables[${variablesLen}];\n${music
      .map((track, index) => {
        return `extern const unsigned int ${track.dataName}_Data[];`;
      })
      .join(`\n`)}\n#endif\n`;
  output[`data_ptrs.c`] =
    `#include "data/data_ptrs.h"\n` +
    `#include "data/${sceneSymbol(startSceneIndex)}.h"\n` +
    `#include "data/${spriteSheetSymbol(playerSpriteIndex)}.h"\n` +
    (customColorsEnabled ? `#include "data/${paletteSymbol(0)}.h"\n` : "") +
    `\n` +
    `int start_scene_x = ${decHex16((startX || 0) * 8)};\n` +
    `int start_scene_y = ${decHex16((startY || 0) * 8)};\n` +
    `char start_scene_dir_x = ${startDirectionX};\n` +
    `char start_scene_dir_y = ${startDirectionY};\n` +
    `far_ptr_t start_scene = ${toFarPtr(sceneSymbol(startSceneIndex))};\n` +
    `far_ptr_t start_player_sprite = ${toFarPtr(spriteSheetSymbol(playerSpriteIndex))};\n` +
    (customColorsEnabled ? `far_ptr_t start_player_palette = ${toFarPtr(paletteSymbol(0))};\n` : "") +
    `unsigned char start_player_move_speed = ${animSpeedDec(startMoveSpeed)};\n` +
    `unsigned char start_player_anim_speed = ${animSpeedDec(startAnimSpeed)};\n` +
    compileEngineFields(engineFields, projectData.engineFieldValues) + '\n' +
    `unsigned char script_variables[${variablesLen}] = { 0 };\n`;

  const maxDataBank = 255;

  return {
    files: output,
    music,
    maxDataBank,
    musicBanks,
  };
};

// #region precompile

const precompile = async (
  projectData,
  projectRoot,
  tmpPath,
  { progress, warnings }
) => {
  progress(EVENT_MSG_PRE_VARIABLES);
  const variables = precompileVariables(projectData.scenes);

  progress(EVENT_MSG_PRE_STRINGS);
  const strings = precompileStrings(projectData.scenes);

  progress(EVENT_MSG_PRE_IMAGES);
  const {
    usedBackgrounds,
    backgroundLookup,
    backgroundData,
    usedTilesets,
    usedTilesetLookup,
  } = await precompileBackgrounds(
    projectData.backgrounds,
    projectData.scenes,
    projectRoot,
    tmpPath,
    { warnings }
  );

  progress(EVENT_MSG_PRE_UI_IMAGES);
  const {
    emotesSprite,
    fontTiles,
    frameTiles,
    cursorTiles,
  } = await precompileUIImages(projectRoot, tmpPath, {
    warnings,
  });

  progress(EVENT_MSG_PRE_SPRITES);
  const { usedSprites } = await precompileSprites(
    projectData.spriteSheets,
    projectData.scenes,
    projectData.settings.playerSpriteSheetId,
    projectRoot,
    {
      warnings,
    }
  );

  progress(EVENT_MSG_PRE_AVATARS);
  const { usedAvatars } = await precompileAvatars(
    projectData.spriteSheets,
    projectData.scenes,
    projectRoot,
    {
      warnings,
    }
  );

  progress(EVENT_MSG_PRE_MUSIC);
  const { usedMusic } = await precompileMusic(
    projectData.scenes,
    projectData.music
  );

  progress(EVENT_MSG_PRE_SCENES);
  const sceneData = precompileScenes(
    projectData.scenes,
    usedBackgrounds,
    usedSprites,
    {
      warnings,
    }
  );

  const { usedPalettes, scenePaletteIndexes, sceneActorPaletteIndexes, actorPaletteIndexes, eventPaletteIndexes } = await precompilePalettes(
    projectData.scenes,
    projectData.settings,
    projectData.palettes,
    {
      warnings,
    }    
  )

  progress(EVENT_MSG_PRE_COMPLETE);

  return {
    variables,
    strings,
    usedBackgrounds,
    backgroundLookup,
    usedTilesets,
    usedTilesetLookup,
    backgroundData,
    usedSprites,
    usedMusic,
    sceneData,
    fontTiles,
    frameTiles,
    cursorTiles,
    emotesSprite,
    usedAvatars,
    usedPalettes,
    scenePaletteIndexes,
    sceneActorPaletteIndexes,
    actorPaletteIndexes,
    eventPaletteIndexes
  };
};

export const compileEngineFields = (engineFields, engineFieldValues, header) => {
  let fieldDef = "";
  if (engineFields.length > 0) {
    for(const engineField of engineFields) {
      const prop = engineFieldValues.find((p) => p.id === engineField.key);
      const customValue = prop && prop.value;
      const value = customValue !== undefined ? Number(customValue) : Number(engineField.defaultValue);
      fieldDef += `${header ? "extern " : ""}${engineField.cType} ${engineField.key}${!header && value !== undefined ? ` = ${value}` : ""};\n`
    }
    fieldDef += `${header ? "extern " : ""}UBYTE *engine_fields_addr${!header ? ` = &${engineFields[0].key}` : ""};\n`
  }
  return fieldDef;
}

export const precompileVariables = (scenes) => {
  const variables = [];

  for (let i = 0; i < 100; i++) {
    variables.push(String(i));
  }
  variables.push(TMP_VAR_1);
  variables.push(TMP_VAR_2);

  walkScenesEvents(scenes, (cmd) => {
    if (eventHasArg(cmd, "variable")) {
      const variable = cmd.args.variable || "0";
      if (variables.indexOf(variable) === -1) {
        variables.push(variable);
      }
    }
    if (eventHasArg(cmd, "vectorX")) {
      const x = cmd.args.vectorX || "0";
      if (variables.indexOf(x) === -1) {
        variables.push(x);
      }
    }
    if (eventHasArg(cmd, "vectorY")) {
      const y = cmd.args.vectorY || "0";
      if (variables.indexOf(y) === -1) {
        variables.push(y);
      }
    }
  });
  return variables;
};

export const precompileStrings = (scenes) => {
  const strings = [];
  walkScenesEvents(scenes, (cmd) => {
    if (
      cmd.args &&
      (cmd.args.text !== undefined || cmd.command === EVENT_TEXT)
    ) {
      const text = cmd.args.text || " "; // Replace empty strings with single space
      // If never seen this string before add it to the list
      if (Array.isArray(text)) {
        for (let i = 0; i < text.length; i++) {
          const rowText = text[i] || " ";
          if (strings.indexOf(rowText) === -1) {
            strings.push(rowText);
          }
        }
      } else if (strings.indexOf(text) === -1) {
        strings.push(text);
      }
    }
  });
  if (strings.length === 0) {
    return ["NOSTRINGS"];
  }
  return strings;
};

export const precompileBackgrounds = async (
  backgrounds,
  scenes,
  projectRoot,
  tmpPath,
  { warnings } = {}
) => {
  const eventImageIds = [];
  walkScenesEvents(scenes, (cmd) => {
    if (eventHasArg(cmd, "backgroundId")) {
      eventImageIds.push(cmd.args.backgroundId);
    }
  });
  const usedBackgrounds = backgrounds.filter(
    (background) =>
      eventImageIds.indexOf(background.id) > -1 ||
      scenes.find((scene) => scene.backgroundId === background.id)
  );
  const backgroundLookup = indexById(usedBackgrounds);
  const backgroundData = await compileImages(
    usedBackgrounds,
    projectRoot,
    tmpPath,
    {
      warnings,
    }
  );
  const usedTilesets = [];
  const usedTilesetLookup = {};
  Object.keys(backgroundData.tilesets).forEach((tileKey) => {
    usedTilesetLookup[tileKey] = usedTilesets.length;
    usedTilesets.push(backgroundData.tilesets[tileKey]);
  });

  const usedBackgroundsWithData = usedBackgrounds.map((background) => {
    return {
      ...background,
      tilesetIndex:
        usedTilesetLookup[backgroundData.tilemapsTileset[background.id]],
      data: backgroundData.tilemaps[background.id],
    };
  });
  return {
    usedBackgrounds: usedBackgroundsWithData,
    usedTilesets,
    // usedTilesetLookup,
    backgroundLookup,
    // backgroundData
  };
};

export const precompilePalettes = async (scenes, settings, palettes, { warnings } = {}) => {
  const usedPalettes = [];
  const usedPalettesCache = {};
  const scenePaletteIndexes = {};
  const sceneActorPaletteIndexes = {};
  const eventPaletteIndexes = {};
  const actorPaletteIndexes = {};
  const MAX_ACTOR_PALETTES = 7;

  if(settings.customColorsEnabled) {

    const palettesLookup = indexById(palettes);
    const defaultBackgroundPaletteIds = settings.defaultBackgroundPaletteIds || [];
    const defaultSpritePaletteId = settings.defaultSpritePaletteId;
    const defaultUIPaletteId = settings.defaultUIPaletteId;

    const getPalette = (id, fallbackId) => {
      if(id === "dmg") {
        return DMG_PALETTE;
      }
      return palettesLookup[id]
        || palettesLookup[fallbackId]
        || DMG_PALETTE;
    }    

    // Player palettes

    const playerPalette = [[].concat(getPalette(settings.playerPaletteId, defaultSpritePaletteId).colors)];
    playerPalette[0][2] = playerPalette[0][1];
    playerPalette[0][1] = playerPalette[0][0];
    const playerPaletteKey = JSON.stringify(playerPalette);
    const playerPaletteIndex = usedPalettes.length;
    usedPalettes.push(playerPalette);
    usedPalettesCache[playerPaletteKey] = playerPaletteIndex;

    // UI palettes

    const uiPalette = [
      getPalette(defaultUIPaletteId)
    ].map((p) => p.colors);
    const uiPaletteKey = JSON.stringify(uiPalette);
    const uiPaletteIndex = usedPalettes.length;
    usedPalettes.push(uiPalette);
    usedPalettesCache[uiPaletteKey] = uiPaletteIndex;

    // Scene palettes

    for(let i=0; i<scenes.length; i++) {
      const scene = scenes[i];
      const sceneBackgroundPaletteIds = scene.paletteIds || [];

      const scenePalette = [
        getPalette(sceneBackgroundPaletteIds[0], defaultBackgroundPaletteIds[0]),
        getPalette(sceneBackgroundPaletteIds[1], defaultBackgroundPaletteIds[1]),
        getPalette(sceneBackgroundPaletteIds[2], defaultBackgroundPaletteIds[2]),
        getPalette(sceneBackgroundPaletteIds[3], defaultBackgroundPaletteIds[3]),
        getPalette(sceneBackgroundPaletteIds[4], defaultBackgroundPaletteIds[4]),
        getPalette(sceneBackgroundPaletteIds[5], defaultBackgroundPaletteIds[5]),
      ].map((p) => p.colors);

      const scenePaletteKey = JSON.stringify(scenePalette);
      if(usedPalettesCache[scenePaletteKey] === undefined) {
        // New palette
        const paletteIndex = usedPalettes.length;
        usedPalettes.push(scenePalette);
        usedPalettesCache[scenePaletteKey] = paletteIndex;
        scenePaletteIndexes[scene.id] = paletteIndex;
      } else {
        // Already used palette
        scenePaletteIndexes[scene.id] = usedPalettesCache[scenePaletteKey];
      }

      // Actor Palettes ---
       
      const sceneActorPalettes = [];
      const sceneActorPalettesCache = {};

      // Determine palettes used for each actor in scene
      for(let a=0; a<scene.actors.length; a++) {
        const actor = scene.actors[a];

        const actorPalette = [].concat(getPalette(actor.paletteId, defaultSpritePaletteId).colors);
        actorPalette[2] = actorPalette[1];
        actorPalette[1] = actorPalette[0];
        const actorPaletteKey = JSON.stringify(actorPalette);

        if(sceneActorPalettesCache[actorPaletteKey] === undefined) {
          const paletteIndex = sceneActorPalettes.length;
          sceneActorPalettes.push(actorPalette);
          sceneActorPalettesCache[actorPaletteKey] = paletteIndex;

          if(sceneActorPalettes.length > MAX_ACTOR_PALETTES) {
            warnings(
              `Scene #${i + 1} ${
                scene.name ? `'${scene.name}'` : ""
              } contains too many unique actor color palettes (${sceneActorPalettes.length} when limit is ${MAX_ACTOR_PALETTES}) some actors may not appear correctly}.`              
            )
          }
        }
      }

      // Sort actor palettes to make it easier to reuse sprite palettes
      // used in a different order in another scene
      // Crop to only allow 7 sprites palettes per scene
      const sortedSceneActorPalettes = sceneActorPalettes
      .slice(0, MAX_ACTOR_PALETTES)
      .sort((a, b) => {
        if(a[0] < b[0]) {
          return -1;
        }
        if (a[0] > b[0]) {
          return 1;
        }
        return 0;
      });

      // Check if sorted sprite palette has already been used already
      const sortedActorPaletteKey = JSON.stringify(sortedSceneActorPalettes);
      if(usedPalettesCache[sortedActorPaletteKey] === undefined) {
        // New palette
        const paletteIndex = usedPalettes.length;
        usedPalettes.push(sortedSceneActorPalettes);
        usedPalettesCache[sortedActorPaletteKey] = paletteIndex;
        sceneActorPaletteIndexes[scene.id] = paletteIndex;
      } else {
        sceneActorPaletteIndexes[scene.id] = usedPalettesCache[sortedActorPaletteKey];
      }

      const sceneUsedActorPalette = usedPalettes[sceneActorPaletteIndexes[scene.id]];
      const sceneUsedActorPaletteKeys = sceneUsedActorPalette.map(JSON.stringify);

      // Determine correct palette index in scene for each actor
      //  based on the sorted and cropped color palette
      for(let a=0; a<scene.actors.length; a++) {
        const actor = scene.actors[a];
        const actorPalette = [].concat(getPalette(actor.paletteId, defaultSpritePaletteId).colors);
        actorPalette[2] = actorPalette[1];
        actorPalette[1] = actorPalette[0];
        const actorPaletteKey = JSON.stringify(actorPalette);
        const actorPaletteIndex = Math.max(0, sceneUsedActorPaletteKeys.indexOf(actorPaletteKey));
        actorPaletteIndexes[actor.id] = actorPaletteIndex;
      }
    }

    // Event palettes

    walkScenesEvents(scenes, (event) => {
      if(event.args && event.command === EVENT_PALETTE_SET_BACKGROUND) {

        const eventPalette = [
          getPalette(event.args.palette0, defaultBackgroundPaletteIds[0]),
          getPalette(event.args.palette1, defaultBackgroundPaletteIds[1]),
          getPalette(event.args.palette2, defaultBackgroundPaletteIds[2]),
          getPalette(event.args.palette3, defaultBackgroundPaletteIds[3]),
          getPalette(event.args.palette4, defaultBackgroundPaletteIds[4]),
          getPalette(event.args.palette5, defaultBackgroundPaletteIds[5]),
        ].map((p) => p.colors);

        const eventPaletteKey = JSON.stringify(eventPalette);
        if(usedPalettesCache[eventPaletteKey] === undefined) {
          // New palette
          const paletteIndex = usedPalettes.length;
          usedPalettes.push(eventPalette);
          usedPalettesCache[eventPaletteKey] = paletteIndex;
          eventPaletteIndexes[event.id] = paletteIndex;
        } else {
          // Already used palette
          eventPaletteIndexes[event.id] = usedPalettesCache[eventPaletteKey];
        }
      } else if (event.args && event.command === EVENT_PALETTE_SET_UI) {
        const eventPalette = [
          getPalette(event.args.palette, defaultUIPaletteId)
        ].map((p) => p.colors);
        const eventPaletteKey = JSON.stringify(eventPalette);
        if(usedPalettesCache[eventPaletteKey] === undefined) {
          // New palette
          const paletteIndex = usedPalettes.length;
          usedPalettes.push(eventPalette);
          usedPalettesCache[eventPaletteKey] = paletteIndex;
          eventPaletteIndexes[event.id] = paletteIndex;
        } else {
          // Already used palette
          eventPaletteIndexes[event.id] = usedPalettesCache[eventPaletteKey];
        }
      }
    })
  }

  return { usedPalettes, scenePaletteIndexes, sceneActorPaletteIndexes, actorPaletteIndexes, eventPaletteIndexes };
}

export const precompileUIImages = async (
  projectRoot,
  tmpPath,
  { warnings }
) => {
  const fontPath = await ensureProjectAsset("assets/ui/ascii.png", {
    projectRoot,
    warnings,
  });
  const framePath = await ensureProjectAsset("assets/ui/frame.png", {
    projectRoot,
    warnings,
  });
  const emotesPath = await ensureProjectAsset("assets/ui/emotes.png", {
    projectRoot,
    warnings,
  });
  const cursorPath = await ensureProjectAsset("assets/ui/cursor.png", {
    projectRoot,
    warnings,
  });

  const frameTiles = await ggbgfx.imageToTilesDataIntArray(framePath);
  const fontTiles = await ggbgfx.imageToTilesDataIntArray(fontPath);
  const cursorTiles = await ggbgfx.imageToTilesDataIntArray(cursorPath);
  const emotesSprite = await ggbgfx.imageToSpriteIntArray(emotesPath);

  return { emotesSprite, frameTiles, fontTiles, cursorTiles };
};

export const precompileSprites = async (
  spriteSheets,
  scenes,
  playerSpriteSheetId,
  projectRoot,
  { warnings } = {}
) => {
  const usedSprites = [];
  const usedSpriteLookup = {};
  const spriteLookup = indexById(spriteSheets);

  if(playerSpriteSheetId) {
    const spriteSheet = spriteLookup[playerSpriteSheetId];
    if (!spriteSheet) {
      warnings(`Player Sprite Sheet isn't set. Please, make sure to select a Sprite Sheet in the Project editor.`);
    }
    usedSprites.push(spriteSheet);
    usedSpriteLookup[playerSpriteSheetId] = spriteSheet;    
  }

  walkScenesEvents(scenes, (event) => {
    if(event.args) {
      if(event.args.spriteSheetId && !usedSpriteLookup[event.args.spriteSheetId] && spriteLookup[event.args.spriteSheetId]) {
        const spriteSheet = spriteLookup[event.args.spriteSheetId];
        usedSprites.push(spriteSheet);
        usedSpriteLookup[event.args.spriteSheetId] = spriteSheet;
      }
    }
  });
  
  for(let i=0; i<scenes.length; i++) {
    const scene = scenes[i];
    for(let a=0; a<scene.actors.length; a++) {
      const actor = scene.actors[a];
      if(actor.spriteSheetId && !usedSpriteLookup[actor.spriteSheetId] && spriteLookup[actor.spriteSheetId]) {
        const spriteSheet = spriteLookup[actor.spriteSheetId];
        usedSprites.push(spriteSheet);
        usedSpriteLookup[actor.spriteSheetId] = spriteSheet;        
      }
    }
  }

  const spriteData = await compileSprites(usedSprites, projectRoot, { warnings });

  return {
    usedSprites: spriteData,
    spriteLookup,
  };
};

export const precompileAvatars = async (
  spriteSheets,
  scenes,
  projectRoot,
  { warnings } = {}
) => {
  const usedAvatars = [];
  const usedAvatarLookup = {};
  const avatarLookup = indexById(spriteSheets);

  walkScenesEvents(scenes, (event) => {
    if(event.args) {
      if(event.args.avatarId && !usedAvatarLookup[event.args.avatarId] && avatarLookup[event.args.avatarId]) {
        const spriteSheet = avatarLookup[event.args.avatarId];
        usedAvatars.push(spriteSheet);
        usedAvatarLookup[event.args.avatarId] = spriteSheet;
      }
    }
  });

  const avatarData = await compileAvatars(usedAvatars, projectRoot, { warnings });

  return {
    usedAvatars: avatarData,
    avatarLookup,
  };
};

export const precompileMusic = (scenes, music) => {
  const usedMusicIds = [];
  walkScenesEvents(scenes, (cmd) => {
    if (
      cmd.args &&
      (cmd.args.musicId !== undefined || cmd.command === EVENT_MUSIC_PLAY)
    ) {
      const musicId = cmd.args.musicId || music[0].id;
      // If never seen this track before add it to the list
      if (usedMusicIds.indexOf(musicId) === -1) {
        usedMusicIds.push(musicId);
      }
    }
  });
  const usedMusic = music
    .filter((track) => {
      return usedMusicIds.indexOf(track.id) > -1;
    })
    .map((track, index) => {
      return {
        ...track,
        dataName: `music_track_` + (index + 101) + "_",
      };
    });
  return { usedMusic };
};

export const precompileScenes = (
  scenes,
  usedBackgrounds,
  usedSprites,
  { warnings } = {}
) => {
  const scenesData = scenes.map((scene, sceneIndex) => {
    const backgroundIndex = usedBackgrounds.findIndex(
      (background) => background.id === scene.backgroundId
    );
    if (backgroundIndex < 0) {
      throw new Error(
        `Scene #${sceneIndex + 1} ${
          scene.name ? `'${scene.name}'` : ""
        } has missing or no background assigned.`
      );
    }

    if (scene.actors.length > MAX_ACTORS) {
      warnings(
        `Scene #${sceneIndex + 1} ${
          scene.name ? `'${scene.name}'` : ""
        } contains ${
          scene.actors.length
        } actors when maximum is ${MAX_ACTORS}. Some actors will be removed.`
      );
    }

    if (scene.triggers.length > MAX_TRIGGERS) {
      warnings(
        `Scene #${sceneIndex + 1} ${
          scene.name ? `'${scene.name}'` : ""
        } contains ${
          scene.triggers.length
        } triggers when maximum is ${MAX_TRIGGERS}. Some triggers will be removed.`
      );
    }

    const actors = scene.actors.slice(0, MAX_ACTORS).filter((actor) => {
      return usedSprites.find((s) => s.id === actor.spriteSheetId);
    });

    const actorSpriteIds = actors.map((a) => a.spriteSheetId);
    const eventSpriteIds = [];

    walkSceneEvents(scene, (event) => {
      if(event.args && event.args.spriteSheetId && event.command !== EVENT_PLAYER_SET_SPRITE && !event.args.__comment) {
        eventSpriteIds.push(event.args.spriteSheetId)
      }
    });

    const sceneSpriteIds = [].concat(actorSpriteIds, eventSpriteIds);

    return {
      ...scene,
      backgroundIndex,
      actors,
      sprites: sceneSpriteIds.reduce((memo, spriteId) => {
        const spriteIndex = usedSprites.findIndex(
          (sprite) => sprite.id === spriteId
        );
        if (spriteIndex !== -1 && memo.indexOf(spriteIndex) === -1) {
          memo.push(spriteIndex);
        }
        return memo;
      }, []),
      triggers: scene.triggers.slice(0, MAX_TRIGGERS).filter((trigger) => {
        // Filter out unused triggers which cause slow down
        // When walking over
        return (
          trigger.script &&
          trigger.script.length >= 1 &&
          trigger.script[0].command !== EVENT_END
        );
      }),
      actorsData: [],
      triggersData: [],
    };
  });
  return scenesData;
};

// #endregion

const ensureProjectAsset = async (relativePath, { projectRoot, warnings }) => {
  const projectPath = `${projectRoot}/${relativePath}`;
  const defaultPath = `${projectTemplatesRoot}/gbhtml/${relativePath}`;
  try {
    await copy(defaultPath, projectPath, {
      overwrite: false,
      errorOnExist: true,
    });
    warnings(
      `${relativePath} was missing, copying default file to project assets`
    );
  } catch (e) {
    // Don't need to catch this, if it failed then the file already exists
    // and we can safely continue.
  }
  return `${projectPath}`;
};

export default compile;
