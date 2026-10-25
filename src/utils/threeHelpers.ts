import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { FurnitureItem, WallSegment } from '../types/render';

export const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return false;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

export function createStudioRenderer(width: number, height: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  return renderer;
}

export function enhanceModelTexturesHD(
  rootObj: THREE.Object3D,
  renderer: THREE.WebGLRenderer | null
) {
  const maxAnisotropy = renderer
    ? renderer.capabilities.getMaxAnisotropy()
    : 8;

  rootObj.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    for (const mat of materials) {
      const stdMat = mat as THREE.MeshStandardMaterial;
      const colorTextures = [stdMat.map, stdMat.emissiveMap];
      for (const tex of colorTextures) {
        if (tex) {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = maxAnisotropy;
          tex.generateMipmaps = true;
          tex.needsUpdate = true;
        }
      }

      const dataTextures = [
        stdMat.normalMap,
        stdMat.roughnessMap,
        stdMat.metalnessMap,
        stdMat.aoMap,
      ];
      for (const tex of dataTextures) {
        if (tex) {
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = maxAnisotropy;
          tex.generateMipmaps = true;
          tex.needsUpdate = true;
        }
      }

      if ('envMapIntensity' in stdMat) {
        stdMat.envMapIntensity = 1.05;
      }
      stdMat.needsUpdate = true;
    }
  });
}

export function applyStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmremGenerator.dispose();
  return envTex;
}

/**
 * Aplana cualquier transformación jerárquica interna de los nodos hijos del .GLB
 * directamente sobre los vértices de cada `BufferGeometry` y deja las matrices de los nodos en identidad (0,0,0).
 */
function flattenHierarchyTransformsIntoGeometry(model: THREE.Object3D): void {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  const rootInverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const meshes: Array<{ mesh: THREE.Mesh; relMatrix: THREE.Matrix4 }> = [];

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        const relMatrix = new THREE.Matrix4().multiplyMatrices(
          rootInverse,
          mesh.matrixWorld
        );
        meshes.push({ mesh, relMatrix });
      }
    }
  });

  // Clonar geometría si está compartida y hornear la matriz relativa si no es identidad
  const identityMat = new THREE.Matrix4();
  for (const { mesh, relMatrix } of meshes) {
    if (!relMatrix.equals(identityMat)) {
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.applyMatrix4(relMatrix);
    }
  }

  // Resetear todos los nodos de la jerarquía a identidad para no rotar matrices de contenedor
  model.traverse((child) => {
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
    child.updateMatrix();
  });
  model.updateMatrixWorld(true);
}

/**
 * Auxiliar matemático: calcula el peso de superficies horizontales (|normal.y| > 0.6)
 * en la mitad inferior (y < midY) vs la mitad superior (y > midY) del modelo.
 * En cualquier maqueta de planta 3D, la losa de piso concentra mucha más área horizontal
 * que la coronación superior de los muros.
 */
function isFloorSlabAtTopHalf(
  model: THREE.Object3D,
  box: THREE.Box3
): boolean {
  const dY = box.max.y - box.min.y;
  if (dY <= 1e-5) return false;
  const midY = (box.min.y + box.max.y) * 0.5;

  let bottomHorizontalScore = 0;
  let topHorizontalScore = 0;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.computeVertexNormals();
      const posAttr = mesh.geometry.attributes.position;
      const normAttr = mesh.geometry.attributes.normal;
      if (!posAttr || posAttr.count === 0) return;

      const step = Math.max(1, Math.floor(posAttr.count / 600));
      for (let i = 0; i < posAttr.count; i += step) {
        v.fromBufferAttribute(posAttr, i);
        let weight = 1.0;
        if (normAttr && i < normAttr.count) {
          n.fromBufferAttribute(normAttr, i);
          if (Math.abs(n.y) > 0.65) {
            weight = 3.0;
          }
        }
        if (v.y < midY) {
          bottomHorizontalScore += weight;
        } else {
          topHorizontalScore += weight;
        }
      }
    }
  });

  return topHorizontalScore > bottomHorizontalScore * 1.05;
}

/**
 * 1 & 2. CORRECCIÓN DEFINITIVA DE ORIENTACIÓN Y HORNEADO EN GPU (v9.7):
 * - Se ejecuta ÚNICAMENTE UNA VEZ al terminar de cargar el archivo .GLB (controlado por `hasBakedInitialGeometryRef`
 *   y `model.userData.__hasBakedInitialGeometry`).
 * - Aplana las transformaciones jerárquicas sin rotar el nodo contenedor (`model.rotation = 0,0,0`).
 * - Mide el Bounding Box inicial `(dX, dY, dZ)`:
 *   a) Si el modelo viene vertical sobre XY (`dZ` es el grosor mínimo), aplica `child.geometry.rotateX(-Math.PI / 2)`
 *      para acostar la cara ancha sobre el plano horizontal XZ.
 *   b) Si el grosor mínimo está en X (`dX` mínimo), aplica `child.geometry.rotateZ(Math.PI / 2)`.
 *   c) Evalúa la distribución de la losa y normales del piso: si la losa quedó en la mitad superior (+Y) y los muros
 *      hacia abajo (-Y), aplica automáticamente `child.geometry.rotateX(Math.PI)` para garantizar que el piso
 *      quede abajo en `Y = 0.00` y los muros se eleven hacia `+Y`.
 * - Recalcula `child.geometry.computeBoundingBox()` y `child.geometry.computeVertexNormals()`.
 */
export function forceModelToLayFlat(
  model: THREE.Object3D,
  targetSpanX = 11.4,
  forceRebake = false
): {
  appliedEulerLabel: string;
  finalSize: THREE.Vector3;
} {
  if (model.userData.__hasBakedInitialGeometry && !forceRebake) {
    const existingBox = new THREE.Box3().setFromObject(model);
    return {
      appliedEulerLabel:
        model.userData.__appliedEulerLabel || 'Bake GPU (Piso Abajo / Muros +Y)',
      finalSize: existingBox.getSize(new THREE.Vector3()),
    };
  }

  // 1) Aplanar transformaciones de nodos hijos en la geometría y dejar matrices de nodos en (0,0,0)
  flattenHierarchyTransformsIntoGeometry(model);

  model.updateMatrixWorld(true);
  const initBox = new THREE.Box3().setFromObject(model);
  const initSize = initBox.getSize(new THREE.Vector3());

  let appliedEulerLabel = 'Bake X=-90° (Piso Abajo / Muros +Y)';

  // 2) Acostar la cara más ancha sobre el plano horizontal XZ (garantizar que dY sea el espesor menor)
  if (initSize.z < initSize.x && initSize.z < initSize.y) {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.rotateX(-Math.PI / 2);
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeVertexNormals();
      }
    });
    appliedEulerLabel = 'Bake X=-90° (GPU)';
  } else if (initSize.x < initSize.y && initSize.x < initSize.z) {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.rotateZ(Math.PI / 2);
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeVertexNormals();
      }
    });
    appliedEulerLabel = 'Bake Z=+90° (GPU)';
  } else {
    // dY ya era la dimensión más delgada; recalcular normales antes de verificar polaridad piso/muros
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeVertexNormals();
      }
    });
    appliedEulerLabel = 'Bake Plano XZ (GPU)';
  }

  // 3) Verificar polaridad vertical (Piso Abajo en Y=0.00 / Muros Arriba hacia +Y):
  //    Si la losa/piso quedó en la mitad superior (+Y), invertir 180° en X para que la losa baje a Y=0.00
  model.updateMatrixWorld(true);
  const flatBox = new THREE.Box3().setFromObject(model);
  if (isFloorSlabAtTopHalf(model, flatBox)) {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.rotateX(Math.PI);
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeVertexNormals();
      }
    });
    appliedEulerLabel = 'Bake +90° X (Piso Abajo / Muros +Y)';
  }

  // 4) Escalar vértices al ancho arquitectónico objetivo y centrar/asentar en Y = 0.00 directamente en GPU
  model.updateMatrixWorld(true);
  const orientedBox = new THREE.Box3().setFromObject(model);
  const orientedSize = orientedBox.getSize(new THREE.Vector3());

  const maxHorizontalSpan = Math.max(orientedSize.x, orientedSize.z, 0.001);
  const scaleFactor =
    targetSpanX > 0 ? targetSpanX / maxHorizontalSpan : 1.0;

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      if (Math.abs(scaleFactor - 1.0) > 1e-4) {
        mesh.geometry.scale(scaleFactor, scaleFactor, scaleFactor);
      }
      mesh.geometry.computeBoundingBox();
    }
  });

  model.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(model);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  const finalSize = scaledBox.getSize(new THREE.Vector3());

  const offsetX = -scaledCenter.x;
  const offsetY = 0.0 - scaledBox.min.y;
  const offsetZ = -scaledCenter.z;

  // Asentar la cara inferior exactamente en Y = 0.00 y centrar (X, Z) en (0, 0) horneando en la geometría
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.translate(offsetX, offsetY, offsetZ);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeVertexNormals();
      if (mesh.geometry.attributes.position) {
        mesh.geometry.attributes.position.needsUpdate = true;
      }
      if (mesh.geometry.attributes.normal) {
        mesh.geometry.attributes.normal.needsUpdate = true;
      }
    }
  });

  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  model.userData.__hasBakedInitialGeometry = true;
  model.userData.__appliedEulerLabel = appliedEulerLabel;

  return {
    appliedEulerLabel,
    finalSize,
  };
}

/**
 * 3. BOTÓN Y ESTADO PERSISTENTE "VOLTEAR 180°" (`flipModel180InGPU`):
 * - Aplica directamente `child.geometry.rotateX(Math.PI)` a todas las sub-mallas en GPU.
 * - Recalcula `child.geometry.computeBoundingBox()` y `child.geometry.computeVertexNormals()`.
 * - Recalcula el Bounding Box global y re-asienta la cara inferior plana exactamente en `Y = 0.00` sobre la losa.
 */
export function flipModel180InGPU(
  model: THREE.Object3D,
  targetSpanX = 11.4
): {
  finalSize: THREE.Vector3;
} {
  flattenHierarchyTransformsIntoGeometry(model);

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      // Clonar BufferGeometry para forzar re-subida inmediata de VBO en WebGL
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.rotateX(Math.PI);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeVertexNormals();
    }
  });

  model.updateMatrixWorld(true);
  const flippedBox = new THREE.Box3().setFromObject(model);
  const flippedSize = flippedBox.getSize(new THREE.Vector3());
  const maxHorizontalSpan = Math.max(flippedSize.x, flippedSize.z, 0.001);
  const scaleFactor =
    targetSpanX > 0 ? targetSpanX / maxHorizontalSpan : 1.0;

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      if (Math.abs(scaleFactor - 1.0) > 1e-4) {
        mesh.geometry.scale(scaleFactor, scaleFactor, scaleFactor);
      }
      mesh.geometry.computeBoundingBox();
    }
  });

  model.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(model);
  const finalCenter = finalBox.getCenter(new THREE.Vector3());
  const finalSize = finalBox.getSize(new THREE.Vector3());

  const offsetX = -finalCenter.x;
  const offsetY = 0.0 - finalBox.min.y;
  const offsetZ = -finalCenter.z;

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.translate(offsetX, offsetY, offsetZ);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeVertexNormals();
      if (mesh.geometry.attributes.position) {
        mesh.geometry.attributes.position.needsUpdate = true;
      }
      if (mesh.geometry.attributes.normal) {
        mesh.geometry.attributes.normal.needsUpdate = true;
      }
    }
  });

  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  return { finalSize };
}

/**
 * ROTACIÓN MANUAL EN 1 CLIC (+90° EN EJE X, Y o Z) HORNEADA DIRECTAMENTE EN VÉRTICES GPU:
 * - Reescribe los vértices de cada sub-malla con `geometry.rotateX/Y/Z(Math.PI / 2)` sin tocar la matriz del nodo.
 * - Recalcula `computeBoundingBox()` y `computeVertexNormals()` y asienta la cara inferior en `Y = 0.00` centrada en `(0, 0)`.
 */
export function rotateModelAxis90(
  model: THREE.Object3D,
  axis: 'x' | 'y' | 'z',
  targetSpanX = 11.4
): {
  finalSize: THREE.Vector3;
} {
  flattenHierarchyTransformsIntoGeometry(model);

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      mesh.geometry = mesh.geometry.clone();
      if (axis === 'x') {
        mesh.geometry.rotateX(Math.PI / 2);
      } else if (axis === 'y') {
        mesh.geometry.rotateY(Math.PI / 2);
      } else {
        mesh.geometry.rotateZ(Math.PI / 2);
      }
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeVertexNormals();
    }
  });

  model.updateMatrixWorld(true);
  const rotatedBox = new THREE.Box3().setFromObject(model);
  const rotatedSize = rotatedBox.getSize(new THREE.Vector3());
  const maxHorizontalSpan = Math.max(rotatedSize.x, rotatedSize.z, 0.001);
  const scaleFactor =
    targetSpanX > 0 ? targetSpanX / maxHorizontalSpan : 1.0;

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      if (Math.abs(scaleFactor - 1.0) > 1e-4) {
        mesh.geometry.scale(scaleFactor, scaleFactor, scaleFactor);
      }
      mesh.geometry.computeBoundingBox();
    }
  });

  model.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(model);
  const finalCenter = finalBox.getCenter(new THREE.Vector3());
  const finalSize = finalBox.getSize(new THREE.Vector3());

  const offsetX = -finalCenter.x;
  const offsetY = 0.0 - finalBox.min.y;
  const offsetZ = -finalCenter.z;

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.translate(offsetX, offsetY, offsetZ);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeVertexNormals();
      if (mesh.geometry.attributes.position) {
        mesh.geometry.attributes.position.needsUpdate = true;
      }
      if (mesh.geometry.attributes.normal) {
        mesh.geometry.attributes.normal.needsUpdate = true;
      }
    }
  });

  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  return { finalSize };
}

/**
 * Wrapper de compatibilidad que delega directamente en forceModelToLayFlat
 */
export function autoOrientAndGroundGlbModel(
  model: THREE.Object3D,
  targetSpanX: number
): {
  appliedQuarterTurnsX: number;
  finalSize: THREE.Vector3;
} {
  const { finalSize } = forceModelToLayFlat(model, targetSpanX);
  return {
    appliedQuarterTurnsX: 0,
    finalSize,
  };
}

/**
 * 2. CENTRADO DE INSPECCIÓN 360° Y ESCALA CAD EN (0,0,0) PARA PIEZAS INDUSTRIALES / PRODUCTOS (v10.0):
 * - PROHIBIDO aplicar el algoritmo 'Auto-Flat' de casas o aplastar la pieza.
 * - Calcula el Bounding Box exacto de la pieza (THREE.Box3).
 * - Obtiene el centroide geométrico (centerX, centerY, centerZ) y traslada los vértices en GPU
 *   para que el centroide quede alineado con el eje (0, 0, 0) y la base inferior quede asentada
 *   exactamente en Y = 0.00 sobre la grilla técnica de medición métrica (GridHelper).
 * - Devuelve `centerOfMass` exacto `(0, finalSize.y * 0.5, 0)` para que `OrbitControls.target`
 *   pivote exactamente sobre el centro de masa de la pieza.
 */
export function centerAndGroundProductModel(
  model: THREE.Object3D,
  targetSpan = 6.2
): {
  appliedEulerLabel: string;
  finalSize: THREE.Vector3;
  centerOfMass: THREE.Vector3;
} {
  flattenHierarchyTransformsIntoGeometry(model);

  model.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(model);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const rawCenter = rawBox.getCenter(new THREE.Vector3());

  // 1) Trasladar primero los vértices para que el centroide geométrico (centerX, centerY, centerZ) quede exactamente en (0, 0, 0)
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.translate(-rawCenter.x, -rawCenter.y, -rawCenter.z);
      mesh.geometry.computeBoundingBox();
    }
  });

  // 2) Escalar uniformemente a escala de inspección CAD métrica sin deformar proporciones (X, Y, Z)
  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z, 0.001);
  const scaleFactor = targetSpan > 0 ? targetSpan / maxDim : 1.0;

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      if (Math.abs(scaleFactor - 1.0) > 1e-4) {
        mesh.geometry.scale(scaleFactor, scaleFactor, scaleFactor);
      }
      mesh.geometry.computeBoundingBox();
    }
  });

  // 3) Asentar la base inferior de la pieza en Y = 0.00 sobre la grilla técnica manteniendo (centerX, centerZ) en (0, 0)
  model.updateMatrixWorld(true);
  const centeredBox = new THREE.Box3().setFromObject(model);
  const centeredCenter = centeredBox.getCenter(new THREE.Vector3());
  const finalSize = centeredBox.getSize(new THREE.Vector3());

  const offsetX = -centeredCenter.x;
  const offsetY = 0.0 - centeredBox.min.y;
  const offsetZ = -centeredCenter.z;

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.translate(offsetX, offsetY, offsetZ);
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeVertexNormals();
      if (mesh.geometry.attributes.position) {
        mesh.geometry.attributes.position.needsUpdate = true;
      }
      if (mesh.geometry.attributes.normal) {
        mesh.geometry.attributes.normal.needsUpdate = true;
      }

      // 3) Reflejos metálicos PBR de estudio industrial para apreciar aristas, relieves y espesores
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const mat of materials) {
        const stdMat = mat as THREE.MeshStandardMaterial;
        if (stdMat && 'roughness' in stdMat && 'metalness' in stdMat) {
          stdMat.metalness = Math.max(stdMat.metalness ?? 0.35, 0.42);
          stdMat.roughness = Math.min(
            Math.max(stdMat.roughness ?? 0.38, 0.22),
            0.52
          );
          stdMat.envMapIntensity = 1.45;
          stdMat.needsUpdate = true;
        }
      }
    }
  });

  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);

  const settledBox = new THREE.Box3().setFromObject(model);
  const centerOfMass = settledBox.getCenter(new THREE.Vector3());
  if (!Number.isFinite(centerOfMass.y)) {
    centerOfMass.set(0, Math.max(0.8, finalSize.y * 0.5), 0);
  }

  model.userData.__hasBakedInitialGeometry = true;
  model.userData.__appliedEulerLabel =
    'Pieza Industrial Centrada (0,0,0) · Base Y=0.00';

  return {
    appliedEulerLabel: 'Pieza Industrial Centrada (0,0,0) · Base Y=0.00',
    finalSize,
    centerOfMass,
  };
}

/**
 * 3. FONDO NEUTRO DE ESTUDIO DE INGENIERÍA (Gradiente Gris Oscuro / Técnico):
 */
export function createIndustrialStudioGradientBackground(
  isLight: boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(256, 220, 40, 256, 256, 360);
  if (isLight) {
    grad.addColorStop(0, '#f1f5f9');
    grad.addColorStop(0.55, '#dce4ee');
    grad.addColorStop(1, '#c2cedd');
  } else {
    grad.addColorStop(0, '#253041');
    grad.addColorStop(0.55, '#141b26');
    grad.addColorStop(1, '#090d14');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 3. GRILLA MÉTRICA GRADUADA EN MILÍMETROS / METROS EN EL PISO (Y = 0.00):
 * Combina una sub-retícula técnica de precisión (divisiones de 100mm / decímetros)
 * con la grilla principal graduada en metros (1.0m) y ejes centrales X / Z en (0,0,0).
 */
export function createMetricEngineeringGridGroup(
  spanMeters = 16,
  isLight = false
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'MetricEngineeringGridGroup';

  // Sub-grilla fina graduada en fracciones métricas (100mm / 0.1m)
  const fineDivisions = Math.round(spanMeters * 10);
  const fineGrid = new THREE.GridHelper(
    spanMeters,
    fineDivisions,
    isLight ? 0x94a3b8 : 0x334155,
    isLight ? 0xcbd5e1 : 0x1e293b
  );
  fineGrid.position.set(0, 0.001, 0);
  const fineMat = fineGrid.material as THREE.Material;
  fineMat.transparent = true;
  fineMat.opacity = isLight ? 0.45 : 0.42;
  fineMat.polygonOffset = true;
  fineMat.polygonOffsetFactor = -1;
  group.add(fineGrid);

  // Grilla principal graduada en metros (1.00m = 1000mm)
  const majorDivisions = Math.round(spanMeters);
  const majorGrid = new THREE.GridHelper(
    spanMeters,
    majorDivisions,
    0xff7a00,
    isLight ? 0x0047ba : 0x38bdf8
  );
  majorGrid.position.set(0, 0.002, 0);
  const majorMat = majorGrid.material as THREE.Material;
  majorMat.transparent = true;
  majorMat.opacity = isLight ? 0.75 : 0.68;
  majorMat.polygonOffset = true;
  majorMat.polygonOffsetFactor = -2;
  group.add(majorGrid);

  // Anillo técnico de referencia en el origen exacto (0, 0, 0)
  const ringGeo = new THREE.RingGeometry(0.18, 0.22, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff7a00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const originRing = new THREE.Mesh(ringGeo, ringMat);
  originRing.position.set(0, 0.003, 0);
  group.add(originRing);

  return group;
}

/**
 * 1. MOTOR DE FUSIÓN ESTRUCTURAL CAD 1:1 (EXTRUSIÓN VECTORIAL DE MUROS A 90°):
 * Lee directamente `blueprint.walls` y `blueprint.rawPolylines` del Paso 1 y extruye los muros
 * con precisión ortogonal a 90°:
 * a) Espesor limpio de muros: 0.15m.
 * b) Recortes geométricos reales de vanos: puertas (dintel a 2.10m) y ventanas (antepecho a 0.90m con cristal translúcido).
 * c) Acabado arquitectónico: Caras laterales en blanco satinado/concreto claro con coronación superior mate (#1E293B).
 */
export function buildCadHybridWallsGroup(
  walls: WallSegment[],
  blueprintWidth: number,
  blueprintDepth: number,
  targetSpanX: number,
  targetSpanZ: number,
  baseWallHeight = 2.4,
  rawPolylines?: Array<{
    points: Array<{ x: number; y: number }>;
    layer?: string;
    closed?: boolean;
  }>
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'CadHybridWalls90Group';

  // Combinar `blueprint.walls` y segmentos adicionales de `blueprint.rawPolylines` si existen
  const effectiveWalls: WallSegment[] = Array.isArray(walls) ? [...walls] : [];

  if (
    effectiveWalls.length === 0 &&
    Array.isArray(rawPolylines) &&
    rawPolylines.length > 0
  ) {
    let polyIdx = 0;
    for (const poly of rawPolylines) {
      const pts = Array.isArray(poly.points) ? poly.points : [];
      for (let i = 0; i < pts.length - 1; i++) {
        effectiveWalls.push({
          id: `raw-poly-wall-${polyIdx++}`,
          x1: Number(pts[i].x) || 0,
          z1: Number(pts[i].y) || 0,
          x2: Number(pts[i + 1].x) || 0,
          z2: Number(pts[i + 1].y) || 0,
          thickness: 0.15,
          height: baseWallHeight,
          isExterior: true,
          openings: [],
        });
      }
    }
  }

  if (effectiveWalls.length === 0) return group;

  const bpW = Math.max(1, Number(blueprintWidth) || 12);
  const bpD = Math.max(1, Number(blueprintDepth) || 10);

  // Detectar si las coordenadas de los muros vienen en metros centrados o en grilla 0..1000 / píxeles
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const w of effectiveWalls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minZ = Math.min(minZ, w.z1, w.z2);
    maxZ = Math.max(maxZ, w.z1, w.z2);
  }
  const rawSpanX = Math.max(0.1, maxX - minX);
  const rawSpanZ = Math.max(0.1, maxZ - minZ);
  const isPixelOrGridSpace =
    rawSpanX > 45 || rawSpanZ > 45 || maxX > 35 || maxZ > 35;
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;

  const toWorldX = (xVal: number) =>
    isPixelOrGridSpace
      ? ((xVal - centerX) / rawSpanX) * targetSpanX
      : (xVal / bpW) * targetSpanX;

  const toWorldZ = (zVal: number) =>
    isPixelOrGridSpace
      ? ((zVal - centerZ) / rawSpanZ) * targetSpanZ
      : (zVal / bpD) * targetSpanZ;

  // c) Acabado arquitectónico: Caras laterales en blanco satinado/concreto claro
  const wallBodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.15,
    clearcoatRoughness: 0.35,
  });

  // c) Coronación superior mate (#1E293B)
  const wallCapMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.78,
    metalness: 0.12,
  });

  // Marco de carpintería de aluminio oscuro para puertas y ventanas
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.32,
    metalness: 0.68,
  });

  // Cristal translúcido físico para ventanas (antepecho a 0.90m)
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.08,
    metalness: 0.05,
    transmission: isSoftwareGl ? 0 : 0.85,
    transparent: true,
    opacity: isSoftwareGl ? 0.38 : 0.88,
    ior: 1.52,
    clearcoat: 1.0,
  });

  // a) Espesor limpio de muros: 0.15m
  const WALL_THICKNESS = 0.15;
  const capHeight = 0.045;

  const addWallBoxSegment = (
    segLen: number,
    yBottom: number,
    yTop: number,
    thickness: number,
    localCenterX: number,
    parentWallGroup: THREE.Group,
    includeTopCap: boolean
  ) => {
    const segH = yTop - yBottom;
    if (segLen <= 0.02 || segH <= 0.02) return;

    const bodyGeo = new THREE.BoxGeometry(segLen, segH, thickness);
    const bodyMesh = new THREE.Mesh(bodyGeo, wallBodyMat);
    bodyMesh.position.set(localCenterX, yBottom + segH * 0.5, 0);
    bodyMesh.castShadow = !isSoftwareGl;
    bodyMesh.receiveShadow = true;
    parentWallGroup.add(bodyMesh);

    if (includeTopCap) {
      const capGeo = new THREE.BoxGeometry(
        segLen + 0.004,
        capHeight,
        thickness + 0.008
      );
      const capMesh = new THREE.Mesh(capGeo, wallCapMat);
      capMesh.position.set(localCenterX, yTop + capHeight * 0.5, 0);
      capMesh.castShadow = !isSoftwareGl;
      capMesh.receiveShadow = true;
      parentWallGroup.add(capMesh);
    }
  };

  const cornerJointKeys = new Set<string>();
  const addOrthogonalCornerJoint = (wx: number, wz: number, wallH: number) => {
    const key = `${Math.round(wx * 20)},${Math.round(wz * 20)}`;
    if (cornerJointKeys.has(key)) return;
    cornerJointKeys.add(key);

    const pillarBody = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_THICKNESS, wallH, WALL_THICKNESS),
      wallBodyMat
    );
    pillarBody.position.set(wx, wallH * 0.5, wz);
    pillarBody.castShadow = !isSoftwareGl;
    pillarBody.receiveShadow = true;
    group.add(pillarBody);

    const pillarCap = new THREE.Mesh(
      new THREE.BoxGeometry(
        WALL_THICKNESS + 0.008,
        capHeight,
        WALL_THICKNESS + 0.008
      ),
      wallCapMat
    );
    pillarCap.position.set(wx, wallH + capHeight * 0.5, wz);
    pillarCap.castShadow = !isSoftwareGl;
    pillarCap.receiveShadow = true;
    group.add(pillarCap);
  };

  for (const w of effectiveWalls) {
    if (w.zoneType === 'outdoor') continue;

    let x1 = toWorldX(Number(w.x1) || 0);
    let z1 = toWorldZ(Number(w.z1) || 0);
    let x2 = toWorldX(Number(w.x2) || 0);
    let z2 = toWorldZ(Number(w.z2) || 0);

    // Rectificación ortogonal a 90° para eliminar cualquier desviación en líneas casi horizontales o verticales
    const rawDx = x2 - x1;
    const rawDz = z2 - z1;
    if (Math.abs(rawDx) > 0.15 && Math.abs(rawDz) < Math.abs(rawDx) * 0.18) {
      const avgZ = (z1 + z2) * 0.5;
      z1 = avgZ;
      z2 = avgZ;
    } else if (
      Math.abs(rawDz) > 0.15 &&
      Math.abs(rawDx) < Math.abs(rawDz) * 0.18
    ) {
      const avgX = (x1 + x2) * 0.5;
      x1 = avgX;
      x2 = avgX;
    }

    const dx = x2 - x1;
    const dz = z2 - z1;
    const wallLen = Math.hypot(dx, dz);
    if (wallLen < 0.12) continue;

    const wallH = baseWallHeight;
    const angle = Math.atan2(dz, dx);

    // Sellar uniones ortogonales en los extremos del muro
    addOrthogonalCornerJoint(x1, z1, wallH);
    addOrthogonalCornerJoint(x2, z2, wallH);

    const wallGroup = new THREE.Group();
    wallGroup.position.set((x1 + x2) * 0.5, 0, (z1 + z2) * 0.5);
    wallGroup.rotation.y = -angle;

    const openings = Array.isArray(w.openings)
      ? [...w.openings].sort(
          (a, b) =>
            (Number(a.offsetRatio) || 0.5) - (Number(b.offsetRatio) || 0.5)
        )
      : [];

    if (openings.length === 0) {
      addWallBoxSegment(
        wallLen,
        0,
        wallH,
        WALL_THICKNESS,
        0,
        wallGroup,
        true
      );
    } else {
      let cursorX = -wallLen * 0.5;
      // b) Recortes geométricos reales de vanos:
      // Puertas: dintel a 2.10m (proporcional a 2.40m = 0.875 * wallH)
      // Ventanas: antepecho a 0.90m (proporcional a 2.40m = 0.375 * wallH) y dintel a 2.10m
      const doorLintelY = (2.1 / 2.4) * wallH;
      const windowSillY = (0.9 / 2.4) * wallH;

      for (const op of openings) {
        const ratio = Math.max(
          0.14,
          Math.min(0.86, Number(op.offsetRatio) || 0.5)
        );
        const opCenterLocalX = -wallLen * 0.5 + ratio * wallLen;
        const maxOpW = Math.min(Number(op.width) || 0.9, wallLen * 0.68);
        const opStart = Math.max(
          cursorX + 0.06,
          opCenterLocalX - maxOpW * 0.5
        );
        const opEnd = Math.min(
          wallLen * 0.5 - 0.06,
          opCenterLocalX + maxOpW * 0.5
        );
        const actualOpW = opEnd - opStart;

        if (actualOpW <= 0.25) continue;

        // Tramo sólido antes del vano
        const preLen = opStart - cursorX;
        if (preLen > 0.03) {
          addWallBoxSegment(
            preLen,
            0,
            wallH,
            WALL_THICKNESS,
            cursorX + preLen * 0.5,
            wallGroup,
            true
          );
        }

        const midX = (opStart + opEnd) * 0.5;
        const isWindow = op.type === 'window';
        const sillH = isWindow ? windowSillY : 0;
        const headerBottom = doorLintelY;

        // Antepecho inferior a 0.90m para ventanas
        if (sillH > 0.04) {
          addWallBoxSegment(
            actualOpW,
            0,
            sillH,
            WALL_THICKNESS,
            midX,
            wallGroup,
            false
          );
        }

        // Dintel superior a 2.10m sobre puertas y ventanas
        if (wallH - headerBottom > 0.04) {
          addWallBoxSegment(
            actualOpW,
            headerBottom,
            wallH,
            WALL_THICKNESS,
            midX,
            wallGroup,
            true
          );
        }

        if (isWindow) {
          // Cristal translúcido y marco perimetral para ventanas
          const winH = Math.max(0.2, headerBottom - sillH);
          const paneMesh = new THREE.Mesh(
            new THREE.BoxGeometry(actualOpW - 0.04, winH - 0.04, 0.024),
            glassMat
          );
          paneMesh.position.set(midX, sillH + winH * 0.5, 0);
          wallGroup.add(paneMesh);

          const sillFrame = new THREE.Mesh(
            new THREE.BoxGeometry(actualOpW, 0.028, WALL_THICKNESS + 0.016),
            frameMat
          );
          sillFrame.position.set(midX, sillH + 0.014, 0);
          wallGroup.add(sillFrame);

          const topFrame = new THREE.Mesh(
            new THREE.BoxGeometry(actualOpW, 0.025, WALL_THICKNESS + 0.014),
            frameMat
          );
          topFrame.position.set(midX, headerBottom - 0.012, 0);
          wallGroup.add(topFrame);
        } else if (op.type === 'door') {
          // Marco de jamba arquitectónico para puertas (dintel a 2.10m)
          for (const sideX of [opStart + 0.015, opEnd - 0.015]) {
            const jamb = new THREE.Mesh(
              new THREE.BoxGeometry(0.03, headerBottom, WALL_THICKNESS + 0.014),
              frameMat
            );
            jamb.position.set(sideX, headerBottom * 0.5, 0);
            wallGroup.add(jamb);
          }
          const topJamb = new THREE.Mesh(
            new THREE.BoxGeometry(actualOpW, 0.03, WALL_THICKNESS + 0.014),
            frameMat
          );
          topJamb.position.set(midX, headerBottom - 0.015, 0);
          wallGroup.add(topJamb);
        }

        cursorX = opEnd;
      }

      // Tramo sólido final después del último vano
      const tailLen = wallLen * 0.5 - cursorX;
      if (tailLen > 0.03) {
        addWallBoxSegment(
          tailLen,
          0,
          wallH,
          WALL_THICKNESS,
          cursorX + tailLen * 0.5,
          wallGroup,
          true
        );
      }
    }

    group.add(wallGroup);
  }

  return group;
}

export function scheduleAfterDraw(
  renderer: THREE.WebGLRenderer,
  cb: () => void,
  timerRef: { id: number }
) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (!gl || typeof gl.fenceSync !== 'function') {
    timerRef.id = window.setTimeout(cb, 80);
    return;
  }
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  const poll = () => {
    const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
    if (state === gl.UNSIGNALED) {
      timerRef.id = window.setTimeout(poll, 5);
    } else {
      if (sync) gl.deleteSync(sync);
      timerRef.id = window.setTimeout(cb, 80);
    }
  };
  timerRef.id = window.setTimeout(poll, 5);
}

/**
 * Generates a soft radial ambient occlusion contact shadow plane to ground 3D objects.
 */
export function createContactShadowMesh(width: number, depth: number, opacity = 0.52): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, `rgba(15, 23, 42, ${opacity})`);
  grad.addColorStop(0.58, `rgba(15, 23, 42, ${opacity * 0.52})`);
  grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(width * 1.28, depth * 1.28);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.004;
  return mesh;
}

/**
 * Procedural Warm Oak Parquet Texture for noble zones (living, dining, bedrooms, hall)
 */
export function createProceduralWoodTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a67446';
  ctx.fillRect(0, 0, 512, 512);

  const plankRows = 8;
  const plankH = 512 / plankRows;
  const plankTones = ['#ad7a4b', '#9e6b3d', '#b58354', '#986538'];

  for (let r = 0; r < plankRows; r++) {
    const y = r * plankH;
    const stagger = (r % 2) * 128;

    for (let c = -1; c < 3; c++) {
      const x = c * 256 + stagger;
      ctx.fillStyle = plankTones[(r + c + 4) % plankTones.length];
      ctx.fillRect(x, y, 256, plankH);

      ctx.strokeStyle = 'rgba(42, 24, 10, 0.42)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 256, plankH);
    }

    // Subtle warm wood grain fibers
    for (let g = 0; g < 16; g++) {
      ctx.strokeStyle = g % 2 === 0 ? 'rgba(62, 35, 14, 0.16)' : 'rgba(235, 195, 148, 0.11)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const gy = y + ((g + 1) / 17) * plankH;
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + 2.5, 340, gy - 2.5, 512, gy);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.5, 3.5);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

/**
 * Procedural Reticulated Porcelain / Stone Tile Texture (Light neutral gray for bathrooms & kitchen)
 */
export function createProceduralTileTexture(
  renderer: THREE.WebGLRenderer,
  baseHex = '#cbd5e1',
  groutHex = '#94a3b8',
  divisions = 6
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  const step = 512 / divisions;
  for (let r = 0; r < divisions; r++) {
    for (let c = 0; c < divisions; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.03)';
      ctx.fillRect(c * step + 2, r * step + 2, step - 4, step - 4);
    }
  }

  // Subtle mineral ceramic speckle
  for (let i = 0; i < 500; i++) {
    const x = (i * 73) % 512;
    const y = (i * 139) % 512;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)';
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.strokeStyle = groutHex;
  ctx.lineWidth = 3;
  for (let i = 0; i <= divisions; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

/**
 * Regla de Adosamiento: Finds the closest wall segment to a furniture item and returns
 * the snapped (x, z) position and rotationY so the back of the item (-Z in local space)
 * rests flush against the wall face.
 */
export function computeWallAttachmentTransform(
  item: FurnitureItem,
  walls: WallSegment[]
): { x: number; z: number; rotationY: number } {
  if (typeof item.rotationY === 'number' && !item.attachToWall) {
    return { x: item.x, z: item.z, rotationY: item.rotationY };
  }
  if (!item.attachToWall || walls.length === 0) {
    return { x: item.x, z: item.z, rotationY: item.rotationY ?? 0 };
  }

  let bestDist = Infinity;
  let bestWall: WallSegment | null = null;
  let bestProjX = item.x;
  let bestProjZ = item.z;

  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dz = w.z2 - w.z1;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-4) continue;

    let t = ((item.x - w.x1) * dx + (item.z - w.z1) * dz) / lenSq;
    t = Math.max(0.08, Math.min(0.92, t));
    const px = w.x1 + t * dx;
    const pz = w.z1 + t * dz;
    const dist = Math.hypot(item.x - px, item.z - pz);

    if (dist < bestDist) {
      bestDist = dist;
      bestWall = w;
      bestProjX = px;
      bestProjZ = pz;
    }
  }

  if (!bestWall || bestDist > 2.2) {
    return { x: item.x, z: item.z, rotationY: item.rotationY ?? 0 };
  }

  // Compute normal vector pointing from the wall toward the furniture item's room position
  let nx = item.x - bestProjX;
  let nz = item.z - bestProjZ;
  const nLen = Math.hypot(nx, nz);
  if (nLen < 1e-4) {
    const wdx = bestWall.x2 - bestWall.x1;
    const wdz = bestWall.z2 - bestWall.z1;
    nx = -wdz;
    nz = wdx;
  } else {
    nx /= nLen;
    nz /= nLen;
  }

  // Rotation so local +Z points along (nx, nz), meaning local -Z (backrest/WC tank) faces the wall
  const rotationY = Math.atan2(nx, nz);
  const offsetFromWallCenter = bestWall.thickness / 2 + item.depth / 2 + 0.02;

  return {
    x: bestProjX + nx * offsetFromWallCenter,
    z: bestProjZ + nz * offsetFromWallCenter,
    rotationY,
  };
}

/**
 * Native Three.js Scene Exporters (.GLB and .OBJ)
 */
export function exportSceneToGLB(scene: THREE.Scene, filename = 'prodalam-render-3d.glb') {
  const exporter = new GLTFExporter();
  exporter.parse(
    scene,
    (result) => {
      if (result instanceof ArrayBuffer) {
        const blob = new Blob([result], { type: 'model/gltf-binary' });
        triggerBlobDownload(blob, filename);
      } else {
        const json = JSON.stringify(result, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        triggerBlobDownload(blob, filename.replace(/\.glb$/i, '.gltf'));
      }
    },
    (err) => {
      console.error('Error exporting GLB:', err);
    },
    { binary: true }
  );
}

export function exportSceneToOBJ(scene: THREE.Scene, filename = 'prodalam-render-3d.obj') {
  const exporter = new OBJExporter();
  const objString = exporter.parse(scene);
  const blob = new Blob([objString], { type: 'text/plain;charset=utf-8' });
  triggerBlobDownload(blob, filename);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
