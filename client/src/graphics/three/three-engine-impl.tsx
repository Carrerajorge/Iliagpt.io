import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { WebGLConfig } from '@shared/schemas/graphics';

export interface ThreeEngineRef {
  getScene: () => THREE.Scene | null;
  getCamera: () => THREE.Camera | null;
  getRenderer: () => THREE.WebGLRenderer | null;
  exportPNG: () => Promise<Blob>;
  loadModel: (url: string, format?: 'gltf' | 'glb') => Promise<THREE.Group>;
  dispose: () => void;
}

interface ThreeEngineImplProps {
  config: WebGLConfig;
  className?: string;
  onReady?: (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) => void;
  onFrame?: (scene: THREE.Scene, camera: THREE.Camera, deltaTime: number) => void;
}

export const ThreeEngineImpl = forwardRef<ThreeEngineRef, ThreeEngineImplProps>(
  function ThreeEngineImpl({ config, className, onReady, onFrame }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const animationFrameRef = useRef<number>(0);
    const clockRef = useRef<THREE.Clock>(new THREE.Clock());
    const isRunningRef = useRef<boolean>(false);

    const getNumericDimension = useCallback((value: number | string | undefined, fallback: number): number => {
      if (value === undefined) return fallback;
      if (typeof value === 'number') return value;
      const parsed = parseFloat(value);
      return isNaN(parsed) ? fallback : parsed;
    }, []);

    const width = getNumericDimension(config.width, 800);
    const height = getNumericDimension(config.height, 600);

    const setupLighting = useCallback((scene: THREE.Scene) => {
      switch (config.lighting) {
        case 'ambient':
          scene.add(new THREE.AmbientLight(0xffffff, 0.8));
          break;
        case 'directional':
          const dirLight = new THREE.DirectionalLight(0xffffff, 1);
          dirLight.position.set(5, 10, 7.5);
          dirLight.castShadow = true;
          scene.add(dirLight);
          scene.add(new THREE.AmbientLight(0xffffff, 0.3));
          break;
        case 'point':
          const pointLight = new THREE.PointLight(0xffffff, 1, 100);
          pointLight.position.set(0, 10, 0);
          scene.add(pointLight);
          scene.add(new THREE.AmbientLight(0xffffff, 0.3));
          break;
        case 'custom':
          break;
        default:
          scene.add(new THREE.AmbientLight(0xffffff, 0.5));
          const defaultDirLight = new THREE.DirectionalLight(0xffffff, 0.8);
          defaultDirLight.position.set(5, 10, 7.5);
          scene.add(defaultDirLight);
      }
    }, [config.lighting]);

    const loadGLTFModel = useCallback(async (url: string): Promise<THREE.Group> => {
      return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
          url,
          (gltf) => {
            const model = gltf.scene;
            if (sceneRef.current) {
              sceneRef.current.add(model);
            }
            resolve(model);
          },
          undefined,
          (error) => {
            reject(error);
          }
        );
      });
    }, []);

    useImperativeHandle(ref, () => ({
      getScene: () => sceneRef.current,
      getCamera: () => cameraRef.current,
      getRenderer: () => rendererRef.current,
      exportPNG: async () => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!renderer || !scene || !camera) {
          return Promise.reject(new Error('Renderer not available'));
        }
        renderer.render(scene, camera);
        return new Promise((resolve, reject) => {
          renderer.domElement.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to export canvas'));
            }
          }, 'image/png');
        });
      },
      loadModel: loadGLTFModel,
      dispose: () => {
        isRunningRef.current = false;
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (controlsRef.current) {
          controlsRef.current.dispose();
        }
        if (rendererRef.current) {
          rendererRef.current.dispose();
        }
        if (sceneRef.current) {
          sceneRef.current.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();
              if (Array.isArray(object.material)) {
                object.material.forEach((mat) => mat.dispose());
              } else {
                object.material.dispose();
              }
            }
          });
        }
      },
    }), [loadGLTFModel]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      if (config.background) {
        scene.background = new THREE.Color(config.background);
      }

      const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
      camera.position.set(0, 2, 5);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: !config.background,
        preserveDrawingBuffer: config.exportable !== false,
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      rendererRef.current = renderer;

      container.appendChild(renderer.domElement);

      setupLighting(scene);

      if (config.enableOrbitControls) {
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 1;
        controls.maxDistance = 100;
        controls.maxPolarAngle = Math.PI / 2;
        controlsRef.current = controls;
      }

      if (config.modelUrl) {
        loadGLTFModel(config.modelUrl).catch(console.error);
      }

      if (onReady) {
        onReady(scene, camera, renderer);
      }

      const clock = clockRef.current;
      clock.start();

      const animate = () => {
        if (!isRunningRef.current) return;

        animationFrameRef.current = requestAnimationFrame(animate);
        const deltaTime = clock.getDelta();

        if (controlsRef.current) {
          controlsRef.current.update();
        }

        if (onFrame && sceneRef.current && cameraRef.current) {
          onFrame(sceneRef.current, cameraRef.current, deltaTime);
        }

        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      };

      isRunningRef.current = true;
      animate();

      return () => {
        isRunningRef.current = false;
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (controlsRef.current) {
          controlsRef.current.dispose();
        }
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer.dispose();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            if (Array.isArray(object.material)) {
              object.material.forEach((mat) => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        });
      };
    }, [width, height, config.background, config.enableOrbitControls, config.modelUrl, config.exportable, setupLighting, loadGLTFModel, onReady, onFrame]);

    useEffect(() => {
      if (!config.responsive) return;

      const container = containerRef.current;
      if (!container) return;

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: newWidth, height: newHeight } = entry.contentRect;
          if (newWidth > 0 && newHeight > 0) {
            if (cameraRef.current) {
              cameraRef.current.aspect = newWidth / newHeight;
              cameraRef.current.updateProjectionMatrix();
            }
            if (rendererRef.current) {
              rendererRef.current.setSize(newWidth, newHeight);
            }
          }
        }
      });

      resizeObserver.observe(container);

      return () => {
        resizeObserver.disconnect();
      };
    }, [config.responsive]);

    return (
      <div
        ref={containerRef}
        className={className}
        data-testid={`three-engine-${config.id}`}
        style={{
          width: config.responsive ? '100%' : width,
          height: config.responsive ? '100%' : height,
          display: 'block',
        }}
      />
    );
  }
);

export default ThreeEngineImpl;
