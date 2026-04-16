import React, { useRef } from 'react';
import { Rect, Ellipse, Group } from 'react-konva';
import type Konva from 'konva';
import type { ShapeElement } from '../../store/types';

interface ShapeNodeProps {
  element: ShapeElement;
  isSelected: boolean;
  onSelect: () => void;
  onTransformEnd: (newAttrs: Partial<ShapeElement>) => void;
}

export function ShapeNode({ element, isSelected, onSelect, onTransformEnd }: ShapeNodeProps) {
  const groupRef = useRef<Konva.Group>(null);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onTransformEnd({
      x: e.target.x(),
      y: e.target.y()
    });
  };

  const handleTransformEnd = () => {
    const node = groupRef.current;
    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    onTransformEnd({
      x: node.x(),
      y: node.y(),
      w: Math.max(20, node.width() * scaleX),
      h: Math.max(20, node.height() * scaleY),
      rotation: node.rotation()
    });
  };

  return (
    <Group
      ref={groupRef}
      x={element.x}
      y={element.y}
      width={element.w}
      height={element.h}
      rotation={element.rotation ?? 0}
      draggable={!element.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
      opacity={element.opacity ?? 1}
    >
      {element.shapeType === 'rect' ? (
        <Rect
          width={element.w}
          height={element.h}
          fill={element.fill}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
          cornerRadius={element.radius ?? 0}
        />
      ) : (
        <Ellipse
          x={element.w / 2}
          y={element.h / 2}
          radiusX={element.w / 2}
          radiusY={element.h / 2}
          fill={element.fill}
          stroke={element.stroke}
          strokeWidth={element.strokeWidth}
        />
      )}
      {isSelected && (
        <Rect
          width={element.w}
          height={element.h}
          stroke="#2563eb"
          strokeWidth={2}
          fill="transparent"
        />
      )}
    </Group>
  );
}
