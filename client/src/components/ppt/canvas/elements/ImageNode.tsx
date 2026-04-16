import React, { useRef, useEffect, useState } from 'react';
import { Image, Group, Rect } from 'react-konva';
import type Konva from 'konva';
import type { ImageElement } from '../../store/types';

interface ImageNodeProps {
  element: ImageElement;
  isSelected: boolean;
  onSelect: () => void;
  onTransformEnd: (newAttrs: Partial<ImageElement>) => void;
}

export function ImageNode({ element, isSelected, onSelect, onTransformEnd }: ImageNodeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setImage(img);
    img.src = element.src;
  }, [element.src]);

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
      {image ? (
        <Image
          image={image}
          width={element.w}
          height={element.h}
        />
      ) : (
        <Rect
          width={element.w}
          height={element.h}
          fill="#e5e7eb"
          stroke="#d1d5db"
          strokeWidth={1}
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
