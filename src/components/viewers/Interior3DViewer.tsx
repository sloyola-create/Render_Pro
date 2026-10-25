import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  BlueprintData,
  Spatial3DAnalysisResult,
  ThemeMode,
} from '../../types/render';
import {
  applyStudioEnvironment,
  buildCadHybridWallsGroup,
  centerAndGroundProductModel,
  createContactShadowMesh,
  createIndustrialStudioGradientBackground,
  createMetricEngineeringGridGroup,
  createStudioRenderer,
  enhanceModelTexturesHD,
  exportSceneToGLB,
  exportSceneToOBJ,
  flipModel180InGPU,
  forceModelToLayFlat,
  isSoftwareGl,
  rotateModelAxis90,
  scheduleAfterDraw,
} from '../../utils/threeHelpers';
import {
  calculateProdalamCommercialMetrics,
} from '../../utils/commercialCalculator';
import {
  refineGlbMaterialsSemantically,
  SemanticRefinementSummary,
} from '../../utils/interiorRefinement';
import {
  AlertTriangle,
  ArrowUpDown,
  Box,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Download,
  Eye,
  FileBox,
  Footprints,
  Layers,
  Loader2,
  RotateCcw,
  RotateCw,
  Share2,
  Sparkles,
  Sun,
  Upload,
} from 'lucide-react';

interface Interior3DViewerProps {
  blueprint: BlueprintData;
  theme: ThemeMode;
  step2RenderUrl?: string | null;
  cachedSpatialData?: Spatial3DAnalysisResult | null;
  cachedSpatialSourceUrl?: string | null;
  onSaveSpatialData?: (data: Spatial3DAnalysisResult, sourceUrl: string) => void;
  readOnlyMode?: boolean;
  sharedModelUrl?: string | null;
  sharedTaskId?: string | null;
  onOpenShareModal?: (info: {
    modelUrl: string | null;
    taskId: string | null;
  }) => void;
  onOpenCommercialQuote?: () => void;
  onExitReadOnlyMode?: () => void;
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

// Cache en memoria para conservar el modelo .GLB generado por Tripo3D durante la sesión
const cachedTripoGlbBySourceUrl = new Map<
  string,
  { glbUrl: string; taskId: string }
>();

export const Interior3DViewer: React.FC<Interior3DViewerProps> = ({
  blueprint,
  theme,
  step2RenderUrl,
  readOnlyMode = false,
  sharedModelUrl = null,
  sharedTaskId = null,
  onOpenShareModal,
  onOpenCommercialQuote,
  onExitReadOnlyMode,
}) => {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const glbModelContainerRef = useRef<THREE.Group | null>(null);
  const cadHybridWallsContainerRef = useRef<THREE.Group | null>(null);
  const furnitureOverlayContainerRef = useRef<THREE.Group | null>(null);
  const step2FloorMeshRef = useRef<THREE.Mesh | null>(null);
  const presentationSlabMeshRef = useRef<THREE.Mesh | null>(null);
  const houseGridHelperRef = useRef<THREE.GridHelper | null>(null);
  const metricEngineeringGridGroupRef = useRef<THREE.Group | null>(null);
  const studioGradientTexRef = useRef<THREE.CanvasTexture | null>(null);
  const loadedRootObjectRef = useRef<THREE.Object3D | null>(null);
  const presentationSlabMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const partCenterOfMassRef = useRef<THREE.Vector3>(
    new THREE.Vector3(0, 1.2, 0)
  );
  const resetCameraRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  // Flag useRef para garantizar que la calibración inicial de cámara ocurra ÚNICAMENTE UNA VEZ tras cargar el modelo
  const isCameraInitializedRef = useRef<boolean>(false);
  // 1. Referencia mutable para garantizar que el horneado inicial de geometría en GPU se ejecute ÚNICAMENTE UNA VEZ al cargar el .GLB
  const hasBakedInitialGeometryRef = useRef<boolean>(false);
  // Referencia de la última fuente cargada para impedir recargas en re-renders de React
  const loadedSourceKeyRef = useRef<string | null>(null);

  // 1. MODO PRODUCTO E INGENIERÍA (Pestaña "Producto / Ingeniería" o Categoría C):
  // Desactiva totalmente la lógica de arquitectura de casas (muros, Auto-Flat de casas y losas con habitaciones)
  const isProductEngineeringMode =
    blueprint.renderType === 'product' || blueprint.category === 'C';
  const isProductEngineeringModeRef = useRef<boolean>(isProductEngineeringMode);

  // Estado de Drag & Drop directo sobre la zona "Importar .GLB / CAD Local"
  const [isDraggingCadFile, setIsDraggingCadFile] = useState<boolean>(false);

  // Estado del Pipeline Oficial Tripo3D API v2
  const [isProcessingTripo, setIsProcessingTripo] = useState<boolean>(false);
  const [tripoProgress, setTripoProgress] = useState<number>(0);
  const [tripoStatusMessage, setTripoStatusMessage] = useState<string>('');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(
    sharedTaskId || null
  );
  const [loadedModelLabel, setLoadedModelLabel] = useState<string | null>(null);
  const [activeGlbDownloadUrl, setActiveGlbDownloadUrl] = useState<
    string | null
  >(sharedModelUrl || null);
  const [tripoErrorDetails, setTripoErrorDetails] = useState<string | null>(
    null
  );
  const [meshStats, setMeshStats] = useState<{
    vertices: number;
    triangles: number;
  }>({ vertices: 0, triangles: 0 });
  const [partDimensionsMeters, setPartDimensionsMeters] = useState<{
    x: number;
    y: number;
    z: number;
  } | null>(null);

  // 3. Estado persistente del botón "Voltear 180° (Invertir)"
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  // Etiqueta del último ajuste de orientación Auto-Flat / Ejes
  const [activeOrientationLabel, setActiveOrientationLabel] = useState<string>(
    isProductEngineeringMode
      ? 'Pieza Industrial Centrada (0,0,0) · Base Y=0.00'
      : 'Bake GPU (Piso Abajo / Muros +Y)'
  );

  // 1 & 2. MODO PREDETERMINADO: "Modo Maqueta IA (Tripo3D .GLB)" con selector a "Modo CAD 1:1 Estructural"
  const [viewMode3D, setViewMode3D] = useState<'tripo_glb' | 'cad_hybrid'>(
    'tripo_glb'
  );

  // 1. CONTROL DE ALTURA / ESTIRAMIENTO VERTICAL EN EJE Y (0.5x a 2.5x, default 1.0x = 2.40m)
  const [wallHeightMultiplier, setWallHeightMultiplier] = useState<number>(1.0);

  // Controles de Presentación, Enriquecimiento Semántico PBR e Iluminación Solar
  const [navMode, setNavMode] = useState<'orbit' | 'walk'>('orbit');
  const [sunAzimuthDeg, setSunAzimuthDeg] = useState<number>(45);
  const [modelScale, setModelScale] = useState<number>(1.0);
  // 2. Forzar showFurnitureOverlay = false por defecto (desactivación absoluta de mobiliario en el piso)
  const [showFurnitureOverlay, setShowFurnitureOverlay] =
    useState<boolean>(false);
  const [semanticStats, setSemanticStats] =
    useState<SemanticRefinementSummary | null>(null);
  const [showHud, setShowHud] = useState<boolean>(true);

  // Referencias mutables para evitar que re-renders de UI o sliders reinicien la escena WebGL o salten la cámara
  const navModeRef = useRef<'orbit' | 'walk'>('orbit');
  const blueprintRef = useRef<BlueprintData>(blueprint);
  const modelScaleRef = useRef<number>(modelScale);
  const wallHeightMultiplierRef = useRef<number>(wallHeightMultiplier);
  const viewMode3DRef = useRef<'tripo_glb' | 'cad_hybrid'>(viewMode3D);
  const showFurnitureOverlayRef = useRef<boolean>(showFurnitureOverlay);
  const sunAzimuthDegRef = useRef<number>(sunAzimuthDeg);
  const floorSpanRef = useRef<{ x: number; z: number }>({
    x: Math.max(9.8, Math.min(13.5, Number(blueprint.totalWidth) || 11.4)),
    z: Math.max(8.2, Math.min(12.5, Number(blueprint.totalDepth) || 9.6)),
  });

  useEffect(() => {
    blueprintRef.current = blueprint;
    isProductEngineeringModeRef.current =
      blueprint.renderType === 'product' || blueprint.category === 'C';
  }, [blueprint]);

  useEffect(() => {
    modelScaleRef.current = modelScale;
  }, [modelScale]);

  useEffect(() => {
    wallHeightMultiplierRef.current = wallHeightMultiplier;
  }, [wallHeightMultiplier]);

  useEffect(() => {
    viewMode3DRef.current = viewMode3D;
  }, [viewMode3D]);

  useEffect(() => {
    showFurnitureOverlayRef.current = showFurnitureOverlay;
  }, [showFurnitureOverlay]);

  useEffect(() => {
    sunAzimuthDegRef.current = sunAzimuthDeg;
  }, [sunAzimuthDeg]);

  const isLight = theme === 'light';
  const commercialMetrics = React.useMemo(
    () => calculateProdalamCommercialMetrics(blueprint),
    [blueprint]
  );

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    navModeRef.current = navMode;
  }, [navMode]);

  // Sincronización en tiempo real de Dirección Solar / Sombras (0° a 360°)
  useEffect(() => {
    const keyLight = keyLightRef.current;
    if (!keyLight) return;
    const rad = (sunAzimuthDeg * Math.PI) / 180;
    const radius = 17.5;
    keyLight.position.set(
      Math.cos(rad) * radius,
      19.5,
      Math.sin(rad) * radius
    );
  }, [sunAzimuthDeg]);

  // 1. CONTROL DE ALTURA / ESTIRAMIENTO VERTICAL EN MODELOS .GLB Y MUROS CAD 1:1 (EJE Y):
  // Ajusta dinámicamente model.scale.y = modelScale * wallHeightMultiplier sin deformar X y Z,
  // manteniendo la base del modelo asentada exactamente en Y = 0.00.
  useEffect(() => {
    const yStretch = modelScale * wallHeightMultiplier;

    const glbContainer = glbModelContainerRef.current;
    if (glbContainer) {
      glbContainer.scale.set(modelScale, yStretch, modelScale);
      const rootObj = loadedRootObjectRef.current;
      if (rootObj) {
        glbContainer.position.y = 0;
        glbContainer.updateMatrixWorld(true);
        const worldBox = new THREE.Box3().setFromObject(rootObj);
        if (Number.isFinite(worldBox.min.y)) {
          glbContainer.position.y = -worldBox.min.y;
          glbContainer.updateMatrixWorld(true);
        }
      }
    }

    const cadWallsContainer = cadHybridWallsContainerRef.current;
    if (cadWallsContainer) {
      cadWallsContainer.scale.set(modelScale, yStretch, modelScale);
      cadWallsContainer.position.y = 0;
    }

    const floorMesh = step2FloorMeshRef.current;
    if (floorMesh) {
      floorMesh.scale.set(modelScale, 1, modelScale);
    }

    const overlay = furnitureOverlayContainerRef.current;
    if (overlay) {
      overlay.scale.set(modelScale, modelScale, modelScale);
      overlay.position.y = 0;
    }
  }, [modelScale, wallHeightMultiplier]);

  // 2. CONMUTADOR DE MODO DE VISUALIZACIÓN 3D (Tripo3D IA vs. Híbrido CAD 1:1)
  useEffect(() => {
    const glbContainer = glbModelContainerRef.current;
    if (glbContainer) {
      glbContainer.visible = isProductEngineeringMode
        ? true
        : viewMode3D === 'tripo_glb';
    }
    const cadWallsContainer = cadHybridWallsContainerRef.current;
    if (cadWallsContainer) {
      // 1.a) Prohibido extruir o mostrar muros de casas en Modo Producto / Ingeniería
      cadWallsContainer.visible =
        !isProductEngineeringMode && viewMode3D === 'cad_hybrid';
    }
  }, [viewMode3D, isProductEngineeringMode]);

  // Conmutar visibilidad de la Capa Híbrida de Enriquecimiento de Artefactos (Furniture AI Overlay)
  useEffect(() => {
    const overlay = furnitureOverlayContainerRef.current;
    if (!overlay) return;
    overlay.visible = !isProductEngineeringMode && showFurnitureOverlay;
  }, [showFurnitureOverlay, isProductEngineeringMode]);

  // 1 & 3. Sincronización dinámica del Estudio Industrial de 3 Puntos + Grilla Métrica vs. Escena Arquitectónica
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const isLightMode = theme === 'light';

    if (isProductEngineeringMode) {
      // 3. Fondo neutro de estudio de ingeniería (gradiente gris oscuro / técnico)
      if (studioGradientTexRef.current) {
        studioGradientTexRef.current.dispose();
      }
      const gradTex = createIndustrialStudioGradientBackground(isLightMode);
      studioGradientTexRef.current = gradTex;
      scene.background = gradTex;
      scene.fog = new THREE.FogExp2(isLightMode ? 0xdce4ee : 0x101620, 0.007);

      // 1.a) Desactivar totalmente losas de casas, pavimento de habitaciones y muros extruidos
      if (presentationSlabMeshRef.current) {
        presentationSlabMeshRef.current.visible = false;
      }
      if (step2FloorMeshRef.current) {
        step2FloorMeshRef.current.visible = false;
      }
      if (houseGridHelperRef.current) {
        houseGridHelperRef.current.visible = false;
      }
      if (cadHybridWallsContainerRef.current) {
        cadHybridWallsContainerRef.current.visible = false;
      }
      if (glbModelContainerRef.current) {
        glbModelContainerRef.current.visible = true;
      }

      // 3. Grilla métrica graduada en milímetros/metros en el piso (Y = 0.00)
      if (metricEngineeringGridGroupRef.current) {
        scene.remove(metricEngineeringGridGroupRef.current);
      }
      const metricGrid = createMetricEngineeringGridGroup(16, isLightMode);
      scene.add(metricGrid);
      metricEngineeringGridGroupRef.current = metricGrid;

      // 3. Iluminación de estudio de 3 puntos (Luz Principal + Luz de Relleno + Luz de Contorno)
      if (keyLightRef.current) {
        keyLightRef.current.intensity = 2.05;
      }
      if (fillLightRef.current) {
        fillLightRef.current.intensity = 0.92;
      }
      if (rimLightRef.current) {
        rimLightRef.current.visible = true;
        rimLightRef.current.intensity = 1.38;
      }
    } else {
      const bgHex = isLightMode ? 0xe5eaf0 : 0x161b22;
      scene.background = new THREE.Color(bgHex);
      scene.fog = new THREE.FogExp2(bgHex, 0.011);

      if (presentationSlabMeshRef.current) {
        presentationSlabMeshRef.current.visible = true;
      }
      if (presentationSlabMatRef.current) {
        presentationSlabMatRef.current.color.setHex(
          isLightMode ? 0xdde4ec : 0x1f2630
        );
      }
      if (step2FloorMeshRef.current) {
        step2FloorMeshRef.current.visible = true;
        const floorMat = step2FloorMeshRef.current
          .material as THREE.MeshStandardMaterial;
        if (floorMat.map) {
          floorMat.map.dispose();
          floorMat.map = null;
        }
        floorMat.color.setHex(isLightMode ? 0xe8eef5 : 0x242c38);
        floorMat.needsUpdate = true;
      }
      if (houseGridHelperRef.current) {
        houseGridHelperRef.current.visible = true;
      }
      if (metricEngineeringGridGroupRef.current) {
        metricEngineeringGridGroupRef.current.visible = false;
      }
      if (cadHybridWallsContainerRef.current) {
        cadHybridWallsContainerRef.current.visible =
          viewMode3DRef.current === 'cad_hybrid';
      }
      if (keyLightRef.current) {
        keyLightRef.current.intensity = 1.75;
      }
      if (fillLightRef.current) {
        fillLightRef.current.intensity = 0.52;
      }
      if (rimLightRef.current) {
        rimLightRef.current.visible = false;
      }
    }
  }, [theme, isProductEngineeringMode]);

  /**
   * 1. ALGORITMO "AUTO-FLAT" MATEMÁTICO DE ORIENTACIÓN EN PISO Y AJUSTE DE EJES EN 1 CLIC:
   * - Evalúa el Bounding Box (dX, dY, dZ) mediante `forceModelToLayFlat` para garantizar que el grosor
   *   vertical (dY) sea siempre la dimensión más delgada (dY <= dX y dY <= dZ), acostando la cara ancha en XZ.
   * - Si se invoca con `manualRotateAxis` ('x' | 'y' | 'z'), gira +90° en ese eje global y re-asienta la base en Y = 0.00.
   */
  const alignAndCenterModelAtOrigin = useCallback(
    (
      rootObj: THREE.Object3D,
      manualAction?:
        | 'x'
        | 'y'
        | 'z'
        | 'flip180'
        | 'autoflat_force'
        | 'center_product'
    ) => {
      const container = glbModelContainerRef.current;
      if (!container)
        return {
          appliedEulerLabel: 'Bake GPU (Piso Abajo / Muros +Y)',
          cadFixturesCount: 0,
        };

      const currentBp = blueprintRef.current;
      const isProductMode =
        isProductEngineeringModeRef.current ||
        currentBp.renderType === 'product' ||
        currentBp.category === 'C';
      const currentScale = modelScaleRef.current;
      const currentWallMultiplier = wallHeightMultiplierRef.current;

      const targetArchitecturalSpan = isProductMode
        ? 6.2
        : Math.max(
            9.8,
            Math.min(13.5, Number(currentBp.totalWidth) || 11.4)
          );

      let appliedEulerLabel = isProductMode
        ? 'Pieza Industrial Centrada (0,0,0) · Base Y=0.00'
        : 'Bake GPU (Piso Abajo / Muros +Y)';
      let finalSize: THREE.Vector3;

      if (manualAction === 'flip180') {
        const res = flipModel180InGPU(rootObj, targetArchitecturalSpan);
        finalSize = res.finalSize;
        appliedEulerLabel = 'Volteo 180° X en GPU (Piso Y=0.00)';
      } else if (
        manualAction === 'x' ||
        manualAction === 'y' ||
        manualAction === 'z'
      ) {
        const res = rotateModelAxis90(
          rootObj,
          manualAction,
          targetArchitecturalSpan
        );
        finalSize = res.finalSize;
        appliedEulerLabel = `Bake +90° ${manualAction.toUpperCase()} (GPU)`;
      } else if (isProductMode || manualAction === 'center_product') {
        // 1.a & 2. MODO PRODUCTO / INGENIERÍA (CATEGORÍA C):
        // Prohibido aplicar Auto-Flat de casas. Centra el centroide geométrico en (0, 0, 0),
        // asienta la base inferior en Y = 0.00 sobre la grilla métrica y calcula el centro de masa para OrbitControls.
        const res = centerAndGroundProductModel(
          rootObj,
          targetArchitecturalSpan
        );
        finalSize = res.finalSize;
        appliedEulerLabel = res.appliedEulerLabel;
        partCenterOfMassRef.current.copy(res.centerOfMass);
        hasBakedInitialGeometryRef.current = true;
      } else if (manualAction === 'autoflat_force') {
        const res = forceModelToLayFlat(rootObj, targetArchitecturalSpan, true);
        finalSize = res.finalSize;
        appliedEulerLabel = res.appliedEulerLabel;
        hasBakedInitialGeometryRef.current = true;
      } else {
        // 1. Garantizar que el horneado inicial de geometría en GPU se ejecute ÚNICAMENTE UNA VEZ al cargar el .GLB
        if (!hasBakedInitialGeometryRef.current) {
          const res = forceModelToLayFlat(
            rootObj,
            targetArchitecturalSpan,
            false
          );
          finalSize = res.finalSize;
          appliedEulerLabel = res.appliedEulerLabel;
          hasBakedInitialGeometryRef.current = true;
        } else {
          const existingBox = new THREE.Box3().setFromObject(rootObj);
          finalSize = existingBox.getSize(new THREE.Vector3());
          appliedEulerLabel =
            rootObj.userData.__appliedEulerLabel ||
            'Bake GPU (Piso Abajo / Muros +Y)';
        }
      }

      setPartDimensionsMeters({
        x: Number(finalSize.x.toFixed(2)),
        y: Number(finalSize.y.toFixed(2)),
        z: Number(finalSize.z.toFixed(2)),
      });

      const settledBox = new THREE.Box3().setFromObject(rootObj);
      const settledCenter = settledBox.getCenter(new THREE.Vector3());
      if (Number.isFinite(settledCenter.y)) {
        partCenterOfMassRef.current.set(
          0,
          Math.max(0.35, settledCenter.y * currentScale * currentWallMultiplier),
          0
        );
      }

      // 2. Ajustar OrbitControls para que el punto pivote de rotación coincida exactamente con el centro de masa de la pieza
      if (isProductMode && controlsRef.current) {
        controlsRef.current.target.copy(partCenterOfMassRef.current);
        controlsRef.current.update();
      }

      floorSpanRef.current = {
        x: Math.max(6.0, finalSize.x),
        z: Math.max(6.0, finalSize.z),
      };

      // Mantener el modelo firme en el contenedor sin re-inicializar la escena ni saltar la cámara
      while (container.children.length > 0) {
        container.remove(container.children[0]);
      }

      // Sombra de contacto (Contact Shadows) suave bajo el modelo .GLB en el suelo
      const contactShadow = createContactShadowMesh(
        Math.max(3.2, finalSize.x * 1.04),
        Math.max(3.2, finalSize.z * 1.04),
        isProductMode ? 0.56 : 0.48
      );
      contactShadow.position.set(0, 0.002, 0);

      container.add(contactShadow);
      container.add(rootObj);
      container.scale.set(
        currentScale,
        currentScale * currentWallMultiplier,
        currentScale
      );
      container.position.y = 0;
      container.updateMatrixWorld(true);
      const verifyBox = new THREE.Box3().setFromObject(rootObj);
      if (Number.isFinite(verifyBox.min.y)) {
        container.position.y = -verifyBox.min.y;
        container.updateMatrixWorld(true);
      }

      // 1.a) En Modo Producto / Ingeniería: prohibido crear losas con habitaciones o extruir blueprint.walls
      if (isProductMode) {
        if (step2FloorMeshRef.current) {
          step2FloorMeshRef.current.visible = false;
        }
        const cadWallsHolder = cadHybridWallsContainerRef.current;
        if (cadWallsHolder) {
          while (cadWallsHolder.children.length > 0) {
            cadWallsHolder.remove(cadWallsHolder.children[0]);
          }
          cadWallsHolder.visible = false;
        }
      } else {
        if (step2FloorMeshRef.current) {
          step2FloorMeshRef.current.visible = true;
          step2FloorMeshRef.current.geometry.dispose();
          const planeGeo = new THREE.PlaneGeometry(
            floorSpanRef.current.x,
            floorSpanRef.current.z
          );
          planeGeo.rotateX(-Math.PI / 2);
          step2FloorMeshRef.current.geometry = planeGeo;
          step2FloorMeshRef.current.scale.set(currentScale, 1, currentScale);
        }

        // Reconstruir los muros 3D vectoriales 90° del Modo CAD 1:1 ajustados a la huella exacta
        const cadWallsHolder = cadHybridWallsContainerRef.current;
        if (cadWallsHolder) {
          while (cadWallsHolder.children.length > 0) {
            cadWallsHolder.remove(cadWallsHolder.children[0]);
          }
          const cadWallsGroup = buildCadHybridWallsGroup(
            currentBp.walls,
            currentBp.totalWidth,
            currentBp.totalDepth,
            floorSpanRef.current.x,
            floorSpanRef.current.z,
            2.4,
            currentBp.rawPolylines
          );
          cadWallsHolder.add(cadWallsGroup);
          cadWallsHolder.scale.set(
            currentScale,
            currentScale * currentWallMultiplier,
            currentScale
          );
          cadWallsHolder.visible = viewMode3DRef.current === 'cad_hybrid';
        }
      }

      // 2. DESACTIVACIÓN Y LIMPIEZA TOTAL DE MOBILIARIO EN EL PISO (BASE FLOOR CLEANUP):
      const overlayHolder = furnitureOverlayContainerRef.current;
      if (overlayHolder) {
        while (overlayHolder.children.length > 0) {
          overlayHolder.remove(overlayHolder.children[0]);
        }
        overlayHolder.visible = false;
      }

      return { appliedEulerLabel, cadFixturesCount: 0 };
    },
    []
  );

  /**
   * 1, 2 & 3. MONTAJE HD DE MODELO .GLB + AUTO-FLAT BOUNDING BOX + DESGLOSE SEMÁNTICO PBR + ESTABILIZACIÓN DE CÁMARA:
   */
  const mountRealGlbObject = useCallback(
    (rootObj: THREE.Object3D, modelLabel: string, downloadUrl?: string) => {
      let vertexCount = 0;
      let triangleCount = 0;

      // Nuevo archivo .GLB cargado: permitir horneado inicial único y resetear estado de volteo
      hasBakedInitialGeometryRef.current = false;
      setIsFlipped(false);

      // Activar sombras HD y contabilizar geometría
      rootObj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = !isSoftwareGl;
          mesh.receiveShadow = true;

          const geom = mesh.geometry;
          if (geom) {
            const posAttr = geom.attributes.position;
            if (posAttr) {
              vertexCount += posAttr.count;
              if (geom.index) {
                triangleCount += Math.round(geom.index.count / 3);
              } else {
                triangleCount += Math.round(posAttr.count / 3);
              }
            }
          }
        }
      });

      // Calidad de textura HD: Forzar minFilter/magFilter y SRGBColorSpace para máxima nitidez
      enhanceModelTexturesHD(rootObj, rendererRef.current);

      loadedRootObjectRef.current = rootObj;

      // 1. Ejecutar horneado inicial de geometría en GPU ÚNICAMENTE UNA VEZ para este .GLB
      const { appliedEulerLabel, cadFixturesCount } =
        alignAndCenterModelAtOrigin(rootObj);
      setActiveOrientationLabel(appliedEulerLabel);

      // 2. DESGLOSE SEMÁNTICO Y RELLENO DE MATERIALES PBR EN THREE.JS:
      const pbrSummary = refineGlbMaterialsSemantically(
        rootObj,
        blueprintRef.current,
        rendererRef.current
      );
      setSemanticStats({
        ...pbrSummary,
        cadOverlayFixturesCount: cadFixturesCount,
      });

      setMeshStats({ vertices: vertexCount, triangles: triangleCount });
      setLoadedModelLabel(modelLabel);
      if (downloadUrl) {
        setActiveGlbDownloadUrl(downloadUrl);
      }
      // 1.d) Mostrar el modelo .glb descargado en el "Modo Maqueta IA (Tripo3D .GLB)"
      setViewMode3D('tripo_glb');
      setIsProcessingTripo(false);
      setTripoErrorDetails(null);

      // 2. ESTABILIZACIÓN DE CÁMARA Y ORBITCONTROLS:
      // Calibrar la cámara inicial ÚNICAMENTE UNA VEZ tras cargar el modelo (prohibido resetear en re-renders)
      if (!isCameraInitializedRef.current) {
        isCameraInitializedRef.current = true;
        resetCameraRef.current?.();
      }
    },
    [alignAndCenterModelAtOrigin]
  );

  // 2. Botón Principal: En modo producto centra la pieza en (0,0,0); en modo casa ejecuta forceModelToLayFlat(model)
  const handleAutoFlatModel = () => {
    const rootObj = loadedRootObjectRef.current;
    if (!rootObj) return;
    setIsFlipped(false);
    const { appliedEulerLabel } = alignAndCenterModelAtOrigin(
      rootObj,
      isProductEngineeringMode ? 'center_product' : 'autoflat_force'
    );
    setActiveOrientationLabel(appliedEulerLabel);
  };

  // 3. BOTÓN Y ESTADO PERSISTENTE "VOLTEAR 180°":
  // a) Conmuta setIsFlipped(!isFlipped)
  // b) Aplica directamente child.geometry.rotateX(Math.PI) a todas las sub-mallas
  // c) Recalcula el Bounding Box global y re-asienta la cara inferior en Y = 0.00 sobre la losa
  // d) Mantiene este estado firme sin re-inicializar el modelo ni saltar la cámara OrbitControls
  const handleFlipModel180 = () => {
    const rootObj = loadedRootObjectRef.current;
    if (!rootObj) return;
    setIsFlipped((prev) => !prev);
    const { appliedEulerLabel } = alignAndCenterModelAtOrigin(
      rootObj,
      'flip180'
    );
    setActiveOrientationLabel(appliedEulerLabel);
  };

  // Botones de ajuste directo en 1 clic: [Rotar +90° X], [Rotar +90° Y] y [Rotar +90° Z]
  const handleRotateAxis90 = (axis: 'x' | 'y' | 'z') => {
    const rootObj = loadedRootObjectRef.current;
    if (!rootObj) return;
    const { appliedEulerLabel } = alignAndCenterModelAtOrigin(rootObj, axis);
    setActiveOrientationLabel(appliedEulerLabel);
  };

  const loadGlbFromUrl = useCallback(
    (glbUrl: string, label: string, sourceStep2Url?: string) => {
      setTripoStatusMessage('Descargando y montando malla 3D (.GLB)...');
      setTripoProgress(98);

      const gltfLoader = new GLTFLoader();
      gltfLoader.load(
        glbUrl,
        (gltf) => {
          if (sourceStep2Url) {
            cachedTripoGlbBySourceUrl.set(sourceStep2Url, {
              glbUrl,
              taskId: label,
            });
            loadedSourceKeyRef.current = sourceStep2Url;
          } else {
            loadedSourceKeyRef.current = glbUrl;
          }
          mountRealGlbObject(gltf.scene, label, glbUrl);
        },
        undefined,
        (err) => {
          setIsProcessingTripo(false);
          setTripoErrorDetails(
            `Error al cargar el modelo .GLB en GLTFLoader: ${
              (err as Error)?.message || String(err)
            }`
          );
        }
      );
    },
    [mountRealGlbObject]
  );

  /**
   * 1. PIPELINE OFICIAL TRIPO3D API v2 ("image_to_model")
   */
  const executeTripo3DPipeline = useCallback(
    async (forceNewTask = false) => {
      // Si estamos en modo visualización compartida (?mode=view&model=...), cargar el modelo compartido directamente
      if (sharedModelUrl && /^(\/|https?:\/\/)/i.test(sharedModelUrl)) {
        setIsProcessingTripo(true);
        loadGlbFromUrl(sharedModelUrl, 'Modelo Compartido 360° (.GLB)');
        return;
      }

      if (sharedTaskId && !step2RenderUrl) {
        setIsProcessingTripo(true);
        setActiveTaskId(sharedTaskId);
        setTripoStatusMessage('Cargando modelo compartido desde Tripo3D API...');
        setTripoProgress(45);
        try {
          const pollRes = await fetch(
            `/api/tripo3d/task/${encodeURIComponent(sharedTaskId)}`
          );
          const pollJson: any = await pollRes.json().catch(() => null);
          if (pollJson?.glbUrl) {
            loadGlbFromUrl(
              pollJson.glbUrl,
              `Tripo3D-${sharedTaskId.slice(0, 8)}.glb`
            );
            return;
          }
        } catch {
          // continúa abajo si falla
        }
        setIsProcessingTripo(false);
        return;
      }

      if (!step2RenderUrl) {
        if (!readOnlyMode) {
          setTripoErrorDetails(
            'No se encontró la imagen fotorrealista del Paso 2 para enviar a Tripo3D API.'
          );
        }
        return;
      }

      if (!forceNewTask && cachedTripoGlbBySourceUrl.has(step2RenderUrl)) {
        // Si el modelo ya está cargado en escena para esta misma imagen del Paso 2, NO recargar ni resetear su orientación/volteo
        if (
          loadedRootObjectRef.current &&
          loadedSourceKeyRef.current === step2RenderUrl
        ) {
          return;
        }
        const cached = cachedTripoGlbBySourceUrl.get(step2RenderUrl)!;
        setIsProcessingTripo(true);
        setActiveTaskId(cached.taskId);
        loadGlbFromUrl(cached.glbUrl, cached.taskId, step2RenderUrl);
        return;
      }

      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      setIsProcessingTripo(true);
      setTripoErrorDetails(null);
      setTripoProgress(8);
      setTripoStatusMessage(
        'Subiendo imagen del Paso 2 a Tripo3D API (upload)...'
      );

      try {
        const startRes = await fetch('/api/tripo3d/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageDataUrl: step2RenderUrl,
          }),
        });

        const startJson: any = await startRes.json().catch(() => null);

        if (!startRes.ok || startJson?.error || !startJson?.taskId) {
          setIsProcessingTripo(false);
          const apiMsg =
            startJson?.tripoResponse?.message ||
            startJson?.message ||
            `Error HTTP ${startRes.status} al crear tarea en Tripo3D API`;
          setTripoErrorDetails(
            `${apiMsg} ${
              startJson?.tripoResponse
                ? JSON.stringify(startJson.tripoResponse)
                : ''
            }`
          );
          return;
        }

        const taskId = String(startJson.taskId);
        setActiveTaskId(taskId);
        setTripoProgress(15);
        setTripoStatusMessage('Procesando en Tripo3D API... 15%');

        pollTimerRef.current = window.setInterval(async () => {
          try {
            const pollRes = await fetch(
              `/api/tripo3d/task/${encodeURIComponent(taskId)}`
            );
            const pollJson: any = await pollRes.json().catch(() => null);

            if (!pollRes.ok || pollJson?.error) {
              if (pollTimerRef.current !== null) {
                window.clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }
              setIsProcessingTripo(false);
              setTripoErrorDetails(
                pollJson?.tripoResponse?.message ||
                  pollJson?.message ||
                  'Error consultando estado de la tarea en Tripo3D API.'
              );
              return;
            }

            const status = String(pollJson?.status || '').toUpperCase();
            const rawPct = Number(pollJson?.progress) || 0;
            const displayPct = Math.max(0, Math.min(99, rawPct));
            setTripoProgress(displayPct);
            setTripoStatusMessage(
              `Procesando en Tripo3D API... ${displayPct}%`
            );

            if (status === 'SUCCESS') {
              if (pollTimerRef.current !== null) {
                window.clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }

              const glbUrl = pollJson?.glbUrl;
              if (!glbUrl) {
                setIsProcessingTripo(false);
                setTripoErrorDetails(
                  'Tripo3D devolvió estado SUCCESS pero no incluyó la URL del archivo .GLB.'
                );
                return;
              }

              setTripoProgress(100);
              setTripoStatusMessage('Procesando en Tripo3D API... 100%');
              loadGlbFromUrl(
                glbUrl,
                `Tripo3D-${taskId.slice(0, 8)}.glb`,
                step2RenderUrl
              );
            } else if (
              status === 'FAILED' ||
              status === 'CANCELLED' ||
              status === 'BANNED' ||
              status === 'EXPIRED'
            ) {
              if (pollTimerRef.current !== null) {
                window.clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }
              setIsProcessingTripo(false);
              setTripoErrorDetails(
                `La tarea en Tripo3D API finalizó con estado: ${status}`
              );
            }
          } catch (pollErr: any) {
            if (pollTimerRef.current !== null) {
              window.clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setIsProcessingTripo(false);
            setTripoErrorDetails(
              pollErr?.message || 'Error de red durante el polling a Tripo3D.'
            );
          }
        }, 3000);
      } catch (err: any) {
        setIsProcessingTripo(false);
        setTripoErrorDetails(
          err?.message || 'Error al conectar con el servidor Tripo3D API.'
        );
      }
    },
    [loadGlbFromUrl, readOnlyMode, sharedModelUrl, sharedTaskId, step2RenderUrl]
  );

  // 4.b) Procesador universal de archivos locales (.GLB, .GLTF, .OBJ, .STL) por botón o Drag & Drop
  const processLocalCadOrMeshFile = useCallback(
    (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const objectUrl = URL.createObjectURL(file);
      setIsProcessingTripo(true);
      setTripoErrorDetails(null);
      setTripoProgress(65);
      setTripoStatusMessage(`Importando pieza 3D local ${file.name}...`);

      if (ext === 'obj') {
        const objLoader = new OBJLoader();
        objLoader.load(
          objectUrl,
          (group) => {
            URL.revokeObjectURL(objectUrl);
            loadedSourceKeyRef.current = file.name;
            mountRealGlbObject(group, file.name);
          },
          undefined,
          () => {
            URL.revokeObjectURL(objectUrl);
            setIsProcessingTripo(false);
            setTripoErrorDetails('No se pudo cargar el archivo .OBJ local.');
          }
        );
      } else if (ext === 'stl') {
        const stlLoader = new STLLoader();
        stlLoader.load(
          objectUrl,
          (geometry) => {
            URL.revokeObjectURL(objectUrl);
            geometry.computeVertexNormals();
            const stlMaterial = new THREE.MeshStandardMaterial({
              color: 0xcbd5e1,
              metalness: 0.72,
              roughness: 0.28,
              envMapIntensity: 1.5,
            });
            const stlMesh = new THREE.Mesh(geometry, stlMaterial);
            const stlGroup = new THREE.Group();
            stlGroup.add(stlMesh);
            loadedSourceKeyRef.current = file.name;
            mountRealGlbObject(stlGroup, file.name);
          },
          undefined,
          () => {
            URL.revokeObjectURL(objectUrl);
            setIsProcessingTripo(false);
            setTripoErrorDetails('No se pudo cargar el archivo .STL local.');
          }
        );
      } else {
        const gltfLoader = new GLTFLoader();
        gltfLoader.load(
          objectUrl,
          (gltf) => {
            URL.revokeObjectURL(objectUrl);
            loadedSourceKeyRef.current = file.name;
            mountRealGlbObject(gltf.scene, file.name);
          },
          undefined,
          () => {
            URL.revokeObjectURL(objectUrl);
            setIsProcessingTripo(false);
            setTripoErrorDetails('No se pudo cargar el archivo .GLB local.');
          }
        );
      }
    },
    [mountRealGlbObject]
  );

  // Carga manual opcional de archivo .GLB / .OBJ / .STL local mediante input
  const handleLocalFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    processLocalCadOrMeshFile(file);
  };

  // Soporte Drag & Drop 100% activo para arrastrar .GLB, .OBJ o .STL directamente al visor
  const handleViewerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (readOnlyMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingCadFile) setIsDraggingCadFile(true);
  };

  const handleViewerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (readOnlyMode) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingCadFile(false);
  };

  const handleViewerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (readOnlyMode) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingCadFile(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    processLocalCadOrMeshFile(file);
  };

  // 2. Inicialización del Visor 3D con Calidad Visual HD y Post-Procesado Fotorrealista
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;
    mount.innerHTML = '';

    let cancelled = false;
    let frameId = 0;
    const swTimer = { id: 0 };
    const disposableTextures: THREE.Texture[] = [];

    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    // 2.a & 2.b: ACESFilmicToneMapping (exposure = 1.2) + PCFSoftShadowMap + localClippingEnabled
    const renderer = createStudioRenderer(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const isInitialProductMode =
      blueprint.renderType === 'product' || blueprint.category === 'C';
    const initialBg = theme === 'light' ? 0xe5eaf0 : 0x161b22;
    const scene = new THREE.Scene();

    if (isInitialProductMode) {
      const gradTex = createIndustrialStudioGradientBackground(
        theme === 'light'
      );
      studioGradientTexRef.current = gradTex;
      scene.background = gradTex;
      scene.fog = new THREE.FogExp2(
        theme === 'light' ? 0xdce4ee : 0x101620,
        0.007
      );
    } else {
      scene.background = new THREE.Color(initialBg);
      scene.fog = new THREE.FogExp2(initialBg, 0.011);
    }
    sceneRef.current = scene;

    const envTex = applyStudioEnvironment(renderer, scene);
    disposableTextures.push(envTex);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 180);
    camera.position.set(0, 10.4, 12.8);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.01;
    controls.minDistance = 1.2;
    controls.maxDistance = 46.0;
    controls.target.set(0, isInitialProductMode ? 1.4 : 0.65, 0);
    controlsRef.current = controls;

    // 3. Iluminación de Estudio de 3 Puntos (Luz Principal + Luz de Relleno + Luz de Contorno) + HemisphereLight
    const hemiLight = new THREE.HemisphereLight(0xfff6e5, 0x64748b, 0.78);
    hemiLight.position.set(0, 26, 0);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.48);
    scene.add(ambientLight);

    // Punto 1: Luz Principal (Key Light)
    const rad = (sunAzimuthDeg * Math.PI) / 180;
    const keyLight = new THREE.DirectionalLight(
      0xfff7ea,
      isInitialProductMode ? 2.05 : 1.75
    );
    keyLight.position.set(
      Math.cos(rad) * 17.5,
      19.5,
      Math.sin(rad) * 17.5
    );
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.radius = 3.8;
    const shadowBound = 13.0;
    keyLight.shadow.camera.left = -shadowBound;
    keyLight.shadow.camera.right = shadowBound;
    keyLight.shadow.camera.top = shadowBound;
    keyLight.shadow.camera.bottom = -shadowBound;
    keyLight.shadow.camera.near = 1.0;
    keyLight.shadow.camera.far = 55.0;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    keyLightRef.current = keyLight;

    // Punto 2: Luz de Relleno (Fill Light)
    const fillLight = new THREE.DirectionalLight(
      0xc7dfff,
      isInitialProductMode ? 0.92 : 0.52
    );
    fillLight.position.set(-13, 12, -11);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    // Punto 3: Luz de Contorno / Recorte Metálico (Rim / Back Light)
    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.38);
    rimLight.position.set(-9, 15, -14);
    rimLight.visible = isInitialProductMode;
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    // Losa Neutra de Presentación (Oculta en Modo Producto / Ingeniería)
    const slabW = Math.max(14.0, (Number(blueprint.totalWidth) || 12) * 1.2);
    const slabD = Math.max(14.0, (Number(blueprint.totalDepth) || 10) * 1.2);
    const presentationSlabGeo = new THREE.BoxGeometry(slabW, 0.22, slabD);
    const presentationSlabMat = new THREE.MeshStandardMaterial({
      color: theme === 'light' ? 0xdde4ec : 0x1f2630,
      roughness: 0.74,
      metalness: 0.06,
    });
    presentationSlabMatRef.current = presentationSlabMat;

    const presentationSlab = new THREE.Mesh(
      presentationSlabGeo,
      presentationSlabMat
    );
    presentationSlab.position.set(0, -0.11, 0);
    presentationSlab.receiveShadow = true;
    presentationSlab.visible = !isInitialProductMode;
    scene.add(presentationSlab);
    presentationSlabMeshRef.current = presentationSlab;

    const gridHelper = new THREE.GridHelper(
      Math.max(slabW, slabD),
      20,
      0x3b82f6,
      0x475569
    );
    gridHelper.position.set(0, 0.002, 0);
    (gridHelper.material as THREE.Material).polygonOffset = true;
    (gridHelper.material as THREE.Material).polygonOffsetFactor = -1;
    gridHelper.visible = !isInitialProductMode;
    scene.add(gridHelper);
    houseGridHelperRef.current = gridHelper;

    // 3. Grilla Métrica Graduada en Milímetros / Metros para Modo Producto / Ingeniería
    const metricGridGroup = createMetricEngineeringGridGroup(
      16,
      theme === 'light'
    );
    metricGridGroup.visible = isInitialProductMode;
    scene.add(metricGridGroup);
    metricEngineeringGridGroupRef.current = metricGridGroup;

    // Contenedor dedicado para la malla .GLB centrada en (0,0,0)
    const glbContainer = new THREE.Group();
    glbContainer.visible = isInitialProductMode
      ? true
      : viewMode3DRef.current === 'tripo_glb';
    scene.add(glbContainer);
    glbModelContainerRef.current = glbContainer;

    const initialTargetSpanX = Math.max(
      9.8,
      Math.min(13.5, Number(blueprint.totalWidth) || 11.4)
    );
    const initialTargetSpanZ = Math.max(
      8.2,
      Math.min(12.5, Number(blueprint.totalDepth) || 9.6)
    );
    floorSpanRef.current = { x: initialTargetSpanX, z: initialTargetSpanZ };

    // 2. PAVIMENTO ARQUITECTÓNICO LIMPIO EN LA BASE (Oculto en Modo Producto / Ingeniería):
    const floorPlaneGeo = new THREE.PlaneGeometry(
      initialTargetSpanX,
      initialTargetSpanZ
    );
    floorPlaneGeo.rotateX(-Math.PI / 2);
    const floorPlaneMat = new THREE.MeshStandardMaterial({
      color: theme === 'light' ? 0xe8eef5 : 0x242c38,
      roughness: 0.78,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const step2FloorMesh = new THREE.Mesh(floorPlaneGeo, floorPlaneMat);
    step2FloorMesh.position.set(0, 0.003, 0);
    step2FloorMesh.receiveShadow = true;
    step2FloorMesh.visible = !isInitialProductMode;
    scene.add(step2FloorMesh);
    step2FloorMeshRef.current = step2FloorMesh;

    // 1. MOTOR DE FUSIÓN ESTRUCTURAL CAD 1:1 (Desactivado totalmente en Modo Producto / Ingeniería)
    const cadWallsContainer = new THREE.Group();
    if (!isInitialProductMode) {
      const initialCadWallsGroup = buildCadHybridWallsGroup(
        blueprint.walls,
        blueprint.totalWidth,
        blueprint.totalDepth,
        initialTargetSpanX,
        initialTargetSpanZ,
        2.4,
        blueprint.rawPolylines
      );
      cadWallsContainer.add(initialCadWallsGroup);
    }
    cadWallsContainer.scale.set(
      modelScaleRef.current,
      modelScaleRef.current * wallHeightMultiplierRef.current,
      modelScaleRef.current
    );
    cadWallsContainer.visible =
      !isInitialProductMode && viewMode3DRef.current === 'cad_hybrid';
    scene.add(cadWallsContainer);
    cadHybridWallsContainerRef.current = cadWallsContainer;

    // Contenedor de mobiliario desactivado por completo (sin muebles procedurales en la base)
    const furnitureOverlayContainer = new THREE.Group();
    furnitureOverlayContainer.visible = false;
    scene.add(furnitureOverlayContainer);
    furnitureOverlayContainerRef.current = furnitureOverlayContainer;

    // Navegación de Cámara ("Vista Maqueta 360°" vs "Perspectiva Peatonal")
    const keysPressed: Record<string, boolean> = {};
    let yaw = 0.35;
    let pitch = -0.04;
    let isDraggingLook = false;
    let prevPointerX = 0;
    let prevPointerY = 0;
    const walkPos = new THREE.Vector3(0, 1.7, 2.2);
    const smoothWalkPos = new THREE.Vector3().copy(walkPos);

    resetCameraRef.current = () => {
      if (navModeRef.current === 'orbit') {
        if (isProductEngineeringModeRef.current) {
          const com = partCenterOfMassRef.current;
          camera.position.set(6.8, Math.max(4.6, com.y + 3.2), 7.8);
          controls.target.copy(com);
        } else {
          camera.position.set(0, 10.4, 12.8);
          controls.target.set(0, 0.65, 0);
        }
        controls.update();
      } else {
        walkPos.set(0, 1.7, 2.2);
        smoothWalkPos.copy(walkPos);
        yaw = 0.35;
        pitch = -0.04;
      }
    };

    resetCameraRef.current();

    const onKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName))
        return;
      keysPressed[e.code] = true;
      if (e.code === 'KeyH') setShowHud((prev) => !prev);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysPressed[e.code] = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (navModeRef.current === 'walk') {
        isDraggingLook = true;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (navModeRef.current === 'walk' && isDraggingLook) {
        const dx = e.clientX - prevPointerX;
        const dy = e.clientY - prevPointerY;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        yaw -= dx * 0.0045;
        pitch = THREE.MathUtils.clamp(
          pitch - dy * 0.0038,
          -Math.PI / 2.6,
          Math.PI / 2.6
        );
      }
    };
    const onPointerUp = () => {
      isDraggingLook = false;
    };

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const domElem = renderer.domElement;
    domElem.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', onResize);

    // 1. Ejecutar automáticamente el pipeline oficial de Tripo3D API v2 al abrir el Paso 3
    executeTripo3DPipeline(false);

    const clock = new THREE.Clock();

    const tick = () => {
      if (cancelled) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const dampFactor = 1 - Math.exp(-10 * dt);

      if (navModeRef.current === 'walk') {
        controls.enabled = false;
        _forward.set(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
        _right.set(Math.cos(yaw), 0, Math.sin(yaw)).normalize();
        _moveVec.set(0, 0, 0);

        if (keysPressed['KeyW'] || keysPressed['ArrowUp'])
          _moveVec.add(_forward);
        if (keysPressed['KeyS'] || keysPressed['ArrowDown'])
          _moveVec.sub(_forward);
        if (keysPressed['KeyD'] || keysPressed['ArrowRight'])
          _moveVec.add(_right);
        if (keysPressed['KeyA'] || keysPressed['ArrowLeft'])
          _moveVec.sub(_right);

        if (_moveVec.lengthSq() > 0) {
          _moveVec.normalize().multiplyScalar(3.6 * dt);
          walkPos.add(_moveVec);
          walkPos.x = THREE.MathUtils.clamp(walkPos.x, -8.5, 8.5);
          walkPos.z = THREE.MathUtils.clamp(walkPos.z, -8.5, 8.5);
          walkPos.y = 1.7;
        }

        smoothWalkPos.lerp(walkPos, dampFactor);
        camera.position.copy(smoothWalkPos);
        _lookTarget.set(
          camera.position.x + Math.sin(yaw) * Math.cos(pitch),
          camera.position.y + Math.sin(pitch),
          camera.position.z - Math.cos(yaw) * Math.cos(pitch)
        );
        camera.lookAt(_lookTarget);
      } else {
        controls.enabled = true;
        controls.update();
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        scheduleAfterDraw(renderer, tick, swTimer);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      clearTimeout(swTimer.id);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      domElem.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      disposableTextures.forEach((t) => t.dispose());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-disparar el pipeline de Tripo3D únicamente cuando cambia la imagen fuente del Paso 2 (sin reiniciar en cambios de tema o estado)
  useEffect(() => {
    if (!sceneRef.current) return;
    executeTripo3DPipeline(false);
  }, [executeTripo3DPipeline, step2RenderUrl]);

  // Si el usuario conmuta a "Producto / Ingeniería" con un modelo ya cargado, re-centrar y ajustar pivote al centro de masa
  useEffect(() => {
    if (isProductEngineeringMode && loadedRootObjectRef.current) {
      const { appliedEulerLabel } = alignAndCenterModelAtOrigin(
        loadedRootObjectRef.current,
        'center_product'
      );
      setActiveOrientationLabel(appliedEulerLabel);
      setViewMode3D('tripo_glb');
    }
  }, [isProductEngineeringMode, alignAndCenterModelAtOrigin]);

  return (
    <div
      onDragOver={handleViewerDragOver}
      onDragLeave={handleViewerDragLeave}
      onDrop={handleViewerDrop}
      className={`relative w-full h-full overflow-hidden transition-colors ${
        isLight ? 'bg-[#E5EAF0]' : 'bg-[#11161F]'
      }`}
    >
      {/* Input oculto para importar un .GLB / .GLTF / .OBJ / .STL local */}
      {!readOnlyMode && (
        <input
          ref={localFileInputRef}
          type="file"
          accept=".glb,.gltf,.obj,.stl"
          onChange={handleLocalFileSelected}
          className="hidden"
        />
      )}

      {/* Overlay visual cuando se arrastra un archivo .GLB / .OBJ / .STL sobre el visor */}
      {isDraggingCadFile && !readOnlyMode && (
        <div className="absolute inset-0 z-40 bg-[#040B29]/80 border-2 border-dashed border-[#FF7A00] flex flex-col items-center justify-center p-6 pointer-events-none">
          <div className="p-4 rounded-2xl bg-[#0047BA]/30 border border-[#0047BA] text-center space-y-2 max-w-md">
            <Upload className="w-10 h-10 text-[#FF7A00] mx-auto animate-bounce" />
            <h3 className="text-base font-bold text-white">
              Soltar Pieza 3D / CAD Local (.GLB, .OBJ, .STL)
            </h3>
            <p className="text-xs font-mono text-[#A6C8FF]">
              Se centrará automáticamente en (0, 0, 0) asentando la base en Y =
              0.00 sobre la grilla métrica
            </p>
          </div>
        </div>
      )}

      {/* Lienzo WebGL Three.js */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Insignia Superior Izquierda */}
      <div className="absolute top-4 left-5 z-10 flex items-center gap-2">
        <div
          className={`border px-3.5 py-2 rounded-xl shadow-md select-none flex items-center gap-3.5 ${
            isLight
              ? 'bg-white/95 border-slate-300 text-[#040B29]'
              : 'bg-[#111827]/95 border-slate-700 text-slate-100'
          }`}
        >
          <div>
            <p className="text-[11px] font-mono font-semibold text-[#FF7A00]">
              {readOnlyMode
                ? 'MODO PRESENTACIÓN 360° · SOLO LECTURA'
                : isProductEngineeringMode
                  ? 'PASO 3 · ESTUDIO INDUSTRIAL 3D (PIEZA / INGENIERÍA)'
                  : viewMode3D === 'cad_hybrid'
                    ? 'PASO 3 · MODO CAD 1:1 ESTRUCTURAL'
                    : 'PASO 3 · MODO MAQUETA IA (TRIPO3D .GLB)'}
            </p>
            <h2 className="text-sm font-bold">{blueprint.title}</h2>
          </div>

          {loadedModelLabel && (
            <div className="pl-3 border-l border-slate-500/25 text-[11px] font-mono space-y-0.5">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="truncate max-w-[180px]">
                  {loadedModelLabel}
                </span>
              </div>
              <div className="text-slate-400 tabular-nums">
                {meshStats.vertices.toLocaleString()} vértices ·{' '}
                {meshStats.triangles.toLocaleString()} triángulos
              </div>
            </div>
          )}

          {readOnlyMode && onExitReadOnlyMode && (
            <button
              type="button"
              onClick={onExitReadOnlyMode}
              className="ml-2 px-3 py-1 rounded-lg bg-[#0047BA] hover:bg-[#002068] text-white text-xs font-semibold cursor-pointer pointer-events-auto"
            >
              Volver al Editor
            </button>
          )}
        </div>
      </div>

      {/* 4. INSIGNIA Y RESUMEN TÉCNICO EN VISOR 3D (Esquina Superior Derecha) */}
      <div className="absolute top-16 right-5 z-10 flex flex-col items-end gap-1.5">
        {isProductEngineeringMode ? (
          <div
            className={`border px-3.5 py-2 rounded-xl shadow-md flex items-center gap-2.5 text-xs font-mono ${
              isLight
                ? 'bg-white/95 border-slate-300 text-[#040B29]'
                : 'bg-[#111827]/95 border-slate-700 text-slate-100'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5 text-[#FF7A00] shrink-0" />
            <span className="tabular-nums font-semibold">
              Origen CAD: (0, 0, 0) | Base: Y=0.00m | Grilla: mm / m | Estudio 3
              Luces PBR
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenCommercialQuote?.()}
            className={`border px-3.5 py-2 rounded-xl shadow-md flex items-center gap-2.5 text-xs font-mono transition-colors cursor-pointer ${
              isLight
                ? 'bg-white/95 border-slate-300 text-[#040B29] hover:border-[#0047BA]'
                : 'bg-[#111827]/95 border-slate-700 text-slate-100 hover:border-[#0047BA]'
            }`}
            title="Abrir Ficha Técnica y Cubicación Estimada Prodalam"
          >
            <Calculator className="w-3.5 h-3.5 text-[#FF7A00] shrink-0" />
            <span className="tabular-nums font-semibold">
              Superficie: {commercialMetrics.habitableAreaM2.toFixed(1)} m² |
              Muros: {commercialMetrics.totalWallsLinearM.toFixed(1)} m linear |
              Calidad: Interior HD PBR
            </span>
          </button>
        )}

        {isProductEngineeringMode && partDimensionsMeters && (
          <div
            className={`border px-3 py-1 rounded-lg text-[11px] font-mono shadow-sm select-none ${
              isLight
                ? 'bg-white/90 border-slate-200 text-slate-700'
                : 'bg-[#111827]/90 border-slate-800 text-slate-300'
            }`}
          >
            Cota Pieza: ΔX {partDimensionsMeters.x}m · ΔY{' '}
            {partDimensionsMeters.y}m · ΔZ {partDimensionsMeters.z}m · Pivote
            Centro de Masa Activo
          </div>
        )}

        {!isProductEngineeringMode && semanticStats && (
          <div
            className={`border px-3 py-1 rounded-lg text-[11px] font-mono shadow-sm select-none ${
              isLight
                ? 'bg-white/90 border-slate-200 text-slate-700'
                : 'bg-[#111827]/90 border-slate-800 text-slate-300'
            }`}
          >
            Loza PBR: {semanticStats.sanitaryCount} · Inox/Grif.:{' '}
            {semanticStats.applianceCount} · Textil/Madera:{' '}
            {semanticStats.textileWoodCount} · Artefactos CAD:{' '}
            {semanticStats.cadOverlayFixturesCount}
          </div>
        )}
      </div>

      {/* 1. PANTALLA DE PROGRESO ASÍNCRONO EN TIEMPO REAL TRIPO3D API v2 */}
      {isProcessingTripo && (
        <div
          className={`absolute inset-0 z-30 flex items-center justify-center p-6 transition-opacity ${
            isLight ? 'bg-slate-900/45' : 'bg-[#040B29]/80'
          }`}
        >
          <div
            className={`max-w-lg w-full rounded-2xl border p-7 shadow-2xl space-y-5 ${
              isLight
                ? 'bg-white border-slate-200 text-[#040B29]'
                : 'bg-[#111827] border-[#0047BA] text-slate-100'
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-[#0047BA]/15 border border-[#0047BA]/40 flex items-center justify-center shrink-0">
                <Loader2 className="w-6 h-6 animate-spin text-[#FF7A00]" />
              </div>
              <div>
                <span className="text-[11px] font-mono font-semibold text-[#FF7A00]">
                  TRIPO3D OPENAPI v2 · IMAGE_TO_MODEL
                </span>
                <h3 className="text-base font-bold">
                  {tripoStatusMessage ||
                    `Procesando en Tripo3D API... ${tripoProgress}%`}
                </h3>
                {activeTaskId && (
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Task ID: {activeTaskId}
                  </p>
                )}
              </div>
            </div>

            {/* Barra de Progreso Porcentual */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#A6C8FF]">
                  Polling cada 3s a api.tripo3d.ai/v2/openapi/task
                </span>
                <span className="text-[#FF7A00] font-semibold tabular-nums">
                  {tripoProgress}%
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-800/80 overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-[#0047BA] to-[#FF7A00] transition-all duration-300"
                  style={{ width: `${Math.max(8, tripoProgress)}%` }}
                />
              </div>
            </div>

            <p
              className={`text-xs ${
                isLight ? 'text-slate-600' : 'text-slate-300'
              }`}
            >
              {isProductEngineeringMode
                ? 'Generando malla 3D industrial (.GLB) a partir del render del Paso 2. Al alcanzar 100%, se centrará en (0,0,0) sobre la grilla métrica con pivote en su centro de masa.'
                : 'Generando malla volumétrica 3D texturizada (.GLB) a partir del render fotorrealista del Paso 2. Al alcanzar 100% (SUCCESS), se orientará horizontalmente en Y=0 y se centrará en (0,0,0).'}
            </p>
          </div>
        </div>
      )}

      {/* 4. BANDERAS DE ERROR Y RETRY EN TRIPO3D API + ZONA ACTIVA DE IMPORTACIÓN .GLB / CAD LOCAL */}
      {!isProcessingTripo && tripoErrorDetails && !readOnlyMode && (
        <div className="absolute top-20 left-5 z-20 max-w-xl">
          <div
            className={`rounded-2xl border p-4 shadow-2xl space-y-3 ${
              isLight
                ? 'bg-white/98 border-red-300 text-[#040B29]'
                : 'bg-[#111827]/98 border-red-500/70 text-slate-100'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Aviso de Conexión Tripo3D API v2</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">
                Fallback CAD Local Activo
              </span>
            </div>

            <p className="text-xs font-mono break-words opacity-90">
              {tripoErrorDetails}
            </p>

            {/* 4.a) Botón prominente: "Reintentar Generación 3D (Tripo3D)" */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => executeTripo3DPipeline(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF7A00] hover:bg-[#e56d00] text-white text-xs font-bold shadow-md cursor-pointer transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Reintentar Generación 3D (Tripo3D)
              </button>

              {!isProductEngineeringMode && (
                <button
                  type="button"
                  onClick={() => {
                    setTripoErrorDetails(null);
                    setViewMode3D('cad_hybrid');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors"
                >
                  Activar Modo CAD 1:1 (Muros 90°)
                </button>
              )}
            </div>

            {/* 4.b) Zona 100% activa de "Importar .GLB / CAD Local" (.GLB, .OBJ, .STL) con Drag & Drop */}
            <div
              onClick={() => localFileInputRef.current?.click()}
              onDragOver={handleViewerDragOver}
              onDragLeave={handleViewerDragLeave}
              onDrop={handleViewerDrop}
              className={`mt-1 rounded-xl border-2 border-dashed p-3.5 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                isLight
                  ? 'border-[#0047BA]/50 bg-[#EBF3FF]/60 hover:bg-[#EBF3FF] text-[#040B29]'
                  : 'border-[#0047BA] bg-[#0b1324]/90 hover:bg-[#101c36] text-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-[#0047BA] text-white shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#FF7A00]">
                    Importar .GLB / CAD Local (Arrastrar o Hacer Clic)
                  </div>
                  <div className="text-[11px] font-mono opacity-80">
                    Soporta archivos .GLB, .GLTF, .OBJ y .STL · Centrado 360° en
                    (0,0,0)
                  </div>
                </div>
              </div>
              <span className="px-3 py-1.5 rounded-lg bg-[#0047BA] hover:bg-[#002068] text-white text-xs font-semibold whitespace-nowrap">
                Seleccionar Archivo
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Guía de Controles en Modo Perspectiva Peatonal */}
      {!isProcessingTripo && navMode === 'walk' && (
        <div
          className={`absolute top-4 right-5 pointer-events-none z-10 border px-3.5 py-2 rounded-xl text-xs shadow-md ${
            isLight
              ? 'bg-white border-[#0047BA] text-[#040B29]'
              : 'bg-[#111827]/95 border-[#0047BA] text-slate-200'
          }`}
        >
          <span className="font-semibold text-[#FF7A00]">
            Perspectiva Peatonal:
          </span>{' '}
          Usa <span className="font-mono font-semibold">WASD / Flechas</span>{' '}
          para desplazarte y{' '}
          <span className="font-mono font-semibold">Arrastrar Mouse</span> para
          mirar alrededor.
        </div>
      )}

      {/* BARRA INFERIOR DE CONTROLES INTERACTIVOS DEL VISOR .GLB */}
      <div
        className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-20 w-[min(1140px,96vw)] transition-transform duration-300 ${
          showHud ? 'translate-y-0' : 'translate-y-[calc(100%-28px)]'
        }`}
      >
        <div className="flex justify-center mb-1.5">
          <button
            type="button"
            onClick={() => setShowHud((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full border text-xs font-medium shadow-md transition-colors cursor-pointer ${
              isLight
                ? 'bg-white border-[#0047BA]/30 text-[#040B29] hover:text-[#0047BA]'
                : 'bg-[#111827] border-[#0047BA] text-slate-300 hover:text-white'
            }`}
          >
            {showHud ? (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-[#FF7A00]" />
                Ocultar Controles (H)
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-[#FF7A00]" />
                Mostrar Controles 3D (H)
              </>
            )}
          </button>
        </div>

        <div
          className={`border rounded-2xl p-3 shadow-2xl flex flex-wrap items-center justify-between gap-2.5 ${
            isLight
              ? 'bg-white/95 border-slate-300 text-[#040B29]'
              : 'bg-[#111827]/95 border-[#0047BA] text-slate-200'
          }`}
        >
          {/* Botón Principal de Generación (Oculto en Modo Solo Lectura) */}
          {!readOnlyMode ? (
            <button
              type="button"
              disabled={isProcessingTripo}
              onClick={() => {
                setViewMode3D('tripo_glb');
                executeTripo3DPipeline(true);
              }}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#FF7A00] hover:bg-[#e56d00] disabled:opacity-50 text-white shadow-sm transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            >
              {isProcessingTripo ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Generar Entorno 3D
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-semibold">
              <Eye className="w-3.5 h-3.5" />
              <span>Vista Interactiva 360°</span>
            </div>
          )}

          {/* 2. SELECTOR DE MODOS DISPONIBLE: En Modo Producto / Ingeniería se desactiva "Modo CAD 1:1 Estructural" de muros de casas */}
          {!isProductEngineeringMode ? (
            <div
              className={`flex items-center gap-1 p-1 rounded-xl border ${
                isLight
                  ? 'bg-slate-100 border-slate-200'
                  : 'bg-[#0b0f19] border-slate-800'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setViewMode3D('tripo_glb');
                  if (!loadedRootObjectRef.current && !isProcessingTripo) {
                    executeTripo3DPipeline(false);
                  }
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode3D === 'tripo_glb'
                    ? 'bg-[#0047BA] text-white'
                    : isLight
                      ? 'text-slate-600 hover:text-[#040B29]'
                      : 'text-slate-400 hover:text-white'
                }`}
                title="Modo Maqueta IA (Tripo3D .GLB): Render 3D de la API Tripo3D con refinamiento PBR y asentamiento en Y=0"
              >
                <Box className="w-3.5 h-3.5 text-[#FF7A00]" />
                Modo Maqueta IA (Tripo3D .GLB)
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewMode3D('cad_hybrid');
                  if (isProcessingTripo) {
                    setIsProcessingTripo(false);
                  }
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode3D === 'cad_hybrid'
                    ? 'bg-[#0047BA] text-white'
                    : isLight
                      ? 'text-slate-600 hover:text-[#040B29]'
                      : 'text-slate-400 hover:text-white'
                }`}
                title="Modo CAD 1:1 Estructural: Extrusión vectorial local a 90° sobre pavimento HD del Paso 2"
              >
                <Layers className="w-3.5 h-3.5 text-[#FF7A00]" />
                Modo CAD 1:1 Estructural
              </button>
            </div>
          ) : (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold ${
                isLight
                  ? 'bg-slate-100 border-slate-300 text-[#0047BA]'
                  : 'bg-[#0b0f19] border-[#0047BA] text-[#A6C8FF]'
              }`}
            >
              <Box className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span>Inspección de Pieza Industrial (Sin Muros de Casa)</span>
            </div>
          )}

          {/* Selector de Vista: "Vista Maqueta 360°" vs "Perspectiva Peatonal" */}
          <div
            className={`flex items-center gap-1 p-1 rounded-xl border ${
              isLight
                ? 'bg-slate-100 border-slate-200'
                : 'bg-[#0b0f19] border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setNavMode('orbit');
                window.setTimeout(() => resetCameraRef.current?.(), 10);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                navMode === 'orbit'
                  ? 'bg-[#0047BA] text-white'
                  : isLight
                    ? 'text-slate-600 hover:text-[#040B29]'
                    : 'text-slate-400 hover:text-white'
              }`}
            >
              <Compass className="w-3.5 h-3.5 text-[#FF7A00]" />
              {isProductEngineeringMode
                ? 'Inspección 360° (Centro de Masa)'
                : 'Vista Maqueta 360°'}
            </button>

            <button
              type="button"
              onClick={() => {
                setNavMode('walk');
                window.setTimeout(() => resetCameraRef.current?.(), 10);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                navMode === 'walk'
                  ? 'bg-[#0047BA] text-white'
                  : isLight
                    ? 'text-slate-600 hover:text-[#040B29]'
                    : 'text-slate-400 hover:text-white'
              }`}
            >
              <Footprints className="w-3.5 h-3.5 text-[#FF7A00]" />
              Perspectiva Peatonal
            </button>
          </div>

          {/* 1. Sliders Interactivos: Altura / Estiramiento (Eje Y), Dirección Solar (0° a 360°) y Escala */}
          <div className="flex flex-wrap items-center gap-3.5">
            {!isProductEngineeringMode && (
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-3.5 h-3.5 text-[#FF7A00]" />
                <span className="text-xs font-medium whitespace-nowrap">
                  Altura de Muros / Estiramiento (Eje Y)
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={wallHeightMultiplier}
                  onChange={(e) =>
                    setWallHeightMultiplier(parseFloat(e.target.value))
                  }
                  className="w-20 accent-[#FF7A00] cursor-pointer"
                  title="Ajusta la altura vertical (Eje Y) de muros y modelo 3D manteniendo la base en Y=0.00"
                />
                <span className="text-xs font-mono text-[#FF7A00] w-20 text-right tabular-nums">
                  {wallHeightMultiplier.toFixed(2)}x (
                  {(wallHeightMultiplier * 2.4).toFixed(1)}m)
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Sun className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span className="text-xs font-medium whitespace-nowrap">
                {isProductEngineeringMode
                  ? 'Ángulo Luz Principal'
                  : 'Dirección Solar / Sombras'}
              </span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={sunAzimuthDeg}
                onChange={(e) => setSunAzimuthDeg(parseInt(e.target.value, 10))}
                className="w-20 accent-[#FF7A00] cursor-pointer"
              />
              <span className="text-xs font-mono text-[#FF7A00] w-9 text-right tabular-nums">
                {sunAzimuthDeg}°
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span className="text-xs font-medium whitespace-nowrap">
                Escala CAD
              </span>
              <input
                type="range"
                min={0.5}
                max={2.2}
                step={0.05}
                value={modelScale}
                onChange={(e) => setModelScale(parseFloat(e.target.value))}
                className="w-16 accent-[#FF7A00] cursor-pointer"
              />
              <span className="text-xs font-mono text-[#FF7A00] w-9 text-right tabular-nums">
                {modelScale.toFixed(1)}x
              </span>
            </div>
          </div>

          {/* Acciones de Orientación en Vértices GPU, Importación CAD Local, Compartir Vista 3D y Exportación */}
          <div className="flex items-center gap-1.5">
            {/* 3. BOTÓN Y ESTADO PERSISTENTE "VOLTEAR 180°": [Voltear 180° (Invertir)] */}
            <button
              type="button"
              onClick={handleFlipModel180}
              aria-pressed={isFlipped}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shadow-xs ${
                isFlipped
                  ? 'border-emerald-400 bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'border-[#FF7A00] bg-[#FF7A00] hover:bg-[#e56d00] text-white'
              }`}
              title="Ejecuta child.geometry.rotateX(Math.PI) en GPU y re-asienta la base inmediatamente en Y=0.00 sin reiniciar el modelo ni la cámara"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {isFlipped
                ? '[Voltear 180° (Invertido ✓)]'
                : '[Voltear 180° (Invertir)]'}
            </button>

            {/* En Modo Producto: [Centrar Pieza en (0,0,0)]; en Modo Casa: [Aplanar en Suelo (Auto-Flat)] */}
            <button
              type="button"
              onClick={handleAutoFlatModel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#FF7A00] bg-[#FF7A00]/20 hover:bg-[#FF7A00]/30 text-[#FF7A00] text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              title={
                isProductEngineeringMode
                  ? 'Centra el centroide geométrico de la pieza en (0,0,0), asienta la base en Y=0.00 y alinea OrbitControls con el centro de masa'
                  : `Ejecuta forceModelToLayFlat(model): garantiza dY <= dX y dY <= dZ y asienta la cara ancha en Y=0.00 (Actual: ${activeOrientationLabel})`
              }
            >
              <Compass className="w-3.5 h-3.5 text-[#FF7A00]" />
              {isProductEngineeringMode
                ? '[Centrar Pieza en (0,0,0)]'
                : '[Aplanar en Suelo (Auto-Flat)]'}
            </button>

            {/* 2. BOTONES DE AJUSTE DIRECTO EN 1 CLIC: [Rotar +90° X], [Rotar +90° Y], [Rotar +90° Z] */}
            <button
              type="button"
              onClick={() => handleRotateAxis90('x')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-[#040B29]'
                  : 'bg-[#1f2937] hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="Girar el modelo +90° en el eje X y asentar la base en Y=0.00"
            >
              <RotateCw className="w-3.5 h-3.5 text-[#FF7A00]" />
              [Rotar +90° X]
            </button>

            <button
              type="button"
              onClick={() => handleRotateAxis90('y')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-[#040B29]'
                  : 'bg-[#1f2937] hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="Girar el modelo +90° en el eje Y (horizontal) manteniendo la base en Y=0.00"
            >
              <RotateCw className="w-3.5 h-3.5 text-[#0047BA] dark:text-[#A6C8FF]" />
              [Rotar +90° Y]
            </button>

            <button
              type="button"
              onClick={() => handleRotateAxis90('z')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-[#040B29]'
                  : 'bg-[#1f2937] hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="Girar el modelo +90° en el eje Z y asentar la base en Y=0.00"
            >
              <RotateCw className="w-3.5 h-3.5 text-emerald-400" />
              [Rotar +90° Z]
            </button>

            <button
              type="button"
              onClick={() => resetCameraRef.current?.()}
              className={`p-1.5 rounded-xl border text-xs transition-colors cursor-pointer ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-[#040B29]'
                  : 'bg-[#1f2937] hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="Centrar Vista 3D en Origen (0,0,0)"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#FF7A00]" />
            </button>

            {!readOnlyMode &&
              !isProductEngineeringMode &&
              onOpenCommercialQuote && (
                <button
                  type="button"
                  onClick={onOpenCommercialQuote}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FF7A00] hover:bg-[#e56d00] text-white transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                  title="Abrir Ficha Técnica y Cotización Estimada Prodalam"
                >
                  <Calculator className="w-3.5 h-3.5" />
                  Cubicación & Cotización Prodalam
                </button>
              )}

            {!readOnlyMode && onOpenShareModal && (
              <button
                type="button"
                onClick={() =>
                  onOpenShareModal({
                    modelUrl: activeGlbDownloadUrl,
                    taskId: activeTaskId,
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#0047BA] hover:bg-[#002068] text-white transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                title="Generar enlace de visualización solo lectura (?mode=view)"
              >
                <Share2 className="w-3.5 h-3.5 text-[#FF7A00]" />
                Compartir Vista 3D
              </button>
            )}

            {!readOnlyMode && (
              <>
                <button
                  type="button"
                  onClick={() => localFileInputRef.current?.click()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    isLight
                      ? 'bg-[#EBF3FF] hover:bg-[#dbeafe] border-[#0047BA] text-[#0047BA]'
                      : 'bg-[#0047BA]/25 hover:bg-[#0047BA]/40 border-[#0047BA] text-white'
                  }`}
                  title="Importar archivo .GLB, .OBJ o .STL local (También puedes arrastrar y soltar en el visor)"
                >
                  <FileBox className="w-3.5 h-3.5 text-[#FF7A00]" />
                  Importar .GLB / CAD Local
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (activeGlbDownloadUrl) {
                      const a = document.createElement('a');
                      a.href = activeGlbDownloadUrl;
                      a.download = `${blueprint.id || 'tripo3d'}-model.glb`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    } else if (sceneRef.current) {
                      exportSceneToGLB(
                        sceneRef.current,
                        `${blueprint.id || 'maqueta'}-3d.glb`
                      );
                    }
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-[#040B29]'
                      : 'bg-[#1f2937] hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                  title="Descargar archivo .GLB"
                >
                  <Download className="w-3.5 h-3.5 text-[#FF7A00]" />
                  .GLB
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (sceneRef.current) {
                      exportSceneToOBJ(
                        sceneRef.current,
                        `${blueprint.id || 'maqueta'}-3d.obj`
                      );
                    }
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-[#040B29]'
                      : 'bg-[#1f2937] hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                  title="Exportar escena en formato .OBJ"
                >
                  <Download className="w-3.5 h-3.5 text-[#A6C8FF]" />
                  .OBJ
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
