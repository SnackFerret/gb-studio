import React from "react";
import { useSelector } from "react-redux";
import styled from "styled-components";
import { RootState } from "../../store/configureStore";
import {
  sceneSelectors,
  spriteAnimationSelectors,
  spriteSheetSelectors,
} from "../../store/features/entities/entitiesState";
import {
  ActorDirection,
  Palette,
} from "../../store/features/entities/entitiesTypes";
import { MetaspriteCanvas } from "../sprites/preview/MetaspriteCanvas";

interface SpriteSheetCanvasProps {
  spriteSheetId: string;
  direction?: ActorDirection;
  frame?: number;
  palette?: Palette;
  palettes?: Palette[];
  offsetPosition?: boolean;
}

const Wrapper = styled.div`
  position: relative;
`;

const directions: ActorDirection[] = ["right", "left", "up", "down"];

const SpriteSheetCanvas = ({
  spriteSheetId,
  direction = "down",
  frame = 0,
  palettes,
  offsetPosition,
}: SpriteSheetCanvasProps) => {
  const sprite = useSelector((state: RootState) =>
    spriteSheetSelectors.selectById(state, spriteSheetId)
  );

  const animations = sprite?.animations || [];

  // Determine animation to use based on type
  let animationIndex = directions.indexOf(direction);
  if (
    sprite?.animationType === "fixed" ||
    sprite?.animationType === "fixed_movement"
  ) {
    animationIndex = 0;
  } else if (sprite?.animationType === "platform_player") {
    if (animationIndex > 1) {
      animationIndex = 0;
    }
  }
  const flipX = sprite?.flipLeft && direction === "left";
  if (flipX) {
    animationIndex = 0;
  }

  const animationId = animations[animationIndex] || "";

  const animation = useSelector((state: RootState) =>
    spriteAnimationSelectors.selectById(state, animationId)
  );
  const frames = animation?.frames || [];
  const metaspriteId = frames[frame % frames.length] || "";

  if (!sprite) {
    return <div />;
  }

  return (
    <Wrapper
      style={
        offsetPosition
          ? {
              top: -sprite.canvasHeight + 8,
              left: 8 - sprite.canvasWidth / 2,
            }
          : undefined
      }
    >
      <MetaspriteCanvas
        spriteSheetId={spriteSheetId}
        metaspriteId={metaspriteId}
        palettes={palettes}
        flipX={flipX}
      />
    </Wrapper>
  );
};

export default SpriteSheetCanvas;
