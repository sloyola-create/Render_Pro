export type RenderType = 'interior' | 'exterior' | 'product';

export type AppPhase = 'workbench2d' | 'ai2d' | 'viewer3d';

export type ThemeMode = 'dark' | 'light';

export type ZoneClassification = 'indoor' | 'outdoor';

export interface WallSegment {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  thickness: number; // 0.15m to 0.20m
  height: number; // default 2.60m
  isExterior?: boolean;
  zoneType?: ZoneClassification;
  openings?: WallOpening[];
}

export interface WallOpening {
  id: string;
  type: 'door' | 'window' | 'passage';
  offsetRatio: number; // 0.1 to 0.9 along wall
  width: number; // meters
  height: number; // meters
  sillHeight: number; // 0 for doors, ~0.9m for windows
  swingDir?: 1 | -1; // 1 = default swing, -1 = inverted swing away from furniture collision (0.80m clearance)
  hingeSide?: 'left' | 'right';
}

export type FurnitureCategory =
  | 'wc'
  | 'vanity'
  | 'shower'
  | 'bed'
  | 'sofa'
  | 'dining_table'
  | 'kitchen_island'
  | 'desk'
  | 'wardrobe'
  | 'patio_set'
  | 'lounger'
  | 'bbq_grill';

export interface FurnitureItem {
  id: string;
  name: string;
  category: FurnitureCategory;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationY?: number; // If omitted, auto-computed by wall-attachment logic
  attachToWall?: boolean;
  roomLabel?: string;
  zoneType?: ZoneClassification;
}

export interface RoomZone {
  id: string;
  name: string;
  type: 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'office' | 'terrace' | 'hall';
  zoneType?: ZoneClassification;
  x: number;
  z: number;
  width: number;
  depth: number;
  floorMaterial: 'wood' | 'porcelain' | 'concrete' | 'stone' | 'deck' | 'grass';
}

export interface ExteriorModule {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  elevationY: number;
  roofType: 'flat_overhang' | 'pitched_industrial' | 'cantilever';
  overhang: number;
  facadeMaterial: 'architectural_concrete' | 'black_steel_cladding' | 'warm_timber_slats' | 'curtain_glass';
  windowBands: number;
}

export interface ProductComponentSpec {
  id: string;
  name: string;
  partType:
    | 'base_plate'
    | 'vertical_column'
    | 'truss_chord'
    | 'diagonal_web'
    | 'wire_mesh_panel'
    | 'stiffener_rib'
    | 'anchor_bolt_group'
    | 'top_cap_beam';
  dimensions: string;
  materialGrade: string;
  offsetFactor: [number, number, number]; // Direction for exploded view
}

export interface DimensionCallout {
  id: string;
  label: string;
  value: string;
  start: [number, number, number];
  end: [number, number, number];
}

export interface CadEntitySpec {
  id: string;
  name?: string;
  shape: 'cylinder' | 'prism' | 'flange' | 'rib' | 'contour' | 'polyline';
  x: number;
  y?: number;
  z: number;
  width?: number;
  depth?: number;
  height?: number;
  radius?: number;
  innerRadius?: number;
  thickness?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  points?: Array<{ x: number; z: number }>;
  material?: 'satin_steel' | 'brushed_aluminum' | 'dark_alloy' | 'copper_accent';
}

export interface BlueprintData {
  id: string;
  title: string;
  subtitle: string;
  renderType: RenderType;
  category?: 'A' | 'B' | 'C';
  totalWidth: number; // meters
  totalDepth: number; // meters
  styleSummary: string;
  primaryColorHex: string;
  accentColorHex: string;
  metalFinish: 'black_steel' | 'galvanized_zinc' | 'brushed_aluminum' | 'corten_steel';
  // Subsystem 1: Interior
  walls: WallSegment[];
  rooms: RoomZone[];
  furniture: FurnitureItem[];
  // Subsystem 2: Exterior
  exteriorModules: ExteriorModule[];
  // Subsystem 3: Product / Engineering
  productArchetype: 'truss_portal' | 'acmafor_fence_system' | 'gabion_retaining_module' | 'custom_extrusion';
  productComponents: ProductComponentSpec[];
  entities?: CadEntitySpec[];
  dimensions: DimensionCallout[];
  // Raw 2D DXF/Vector polylines if loaded from DXF
  rawPolylines?: Array<{ points: Array<{ x: number; y: number }>; layer?: string; closed?: boolean }>;
}

export interface Controls2DState {
  showGrid: boolean;
  grayscale: boolean;
  invertColors: boolean;
  lineThickness: number; // 1 to 6 px
  zoom: number;
  panX: number;
  panY: number;
}

export type Spatial3DFurnitureType =
  | 'sofa'
  | 'bed'
  | 'table'
  | 'wc'
  | 'vanity'
  | 'kitchen'
  | 'shower'
  | 'wardrobe'
  | 'desk'
  | 'patio_set'
  | 'lounger'
  | 'bbq_grill';

export interface Spatial3DOpening {
  id: string;
  wallId?: string;
  type: 'door' | 'window' | 'passage';
  x?: number; // 0 to 1000 integer grid X
  z?: number; // 0 to 1000 integer grid Z (vertical image axis)
  offsetRatio: number; // 0.1 to 0.9 along the wall segment
  width: number; // meters
  height: number; // meters
  sillHeight: number; // meters (0 for doors, ~0.9 for windows)
}

export interface Spatial3DWall {
  id: string;
  x1: number; // 0 to 1000 integer grid
  z1: number; // 0 to 1000 integer grid
  x2: number; // 0 to 1000 integer grid
  z2: number; // 0 to 1000 integer grid
  height: number; // Y height in meters
  thickness: number; // exact wall thickness in meters (0.15m)
  isExterior?: boolean;
  zoneType?: ZoneClassification;
  openings: Spatial3DOpening[];
}

export interface Spatial3DZone {
  id: string;
  name: string;
  zoneType: ZoneClassification; // "indoor" | "outdoor"
  surfaceMaterial?: 'deck' | 'grass' | 'stone' | 'wood' | 'porcelain';
  minX: number; // 0 to 1000 integer grid
  minZ: number; // 0 to 1000 integer grid
  maxX: number; // 0 to 1000 integer grid
  maxZ: number; // 0 to 1000 integer grid
}

export interface Spatial3DFurnitureItem {
  id: string;
  type: Spatial3DFurnitureType;
  name: string;
  zoneType: ZoneClassification; // "indoor" | "outdoor"
  x: number; // 0 to 1000 integer grid X
  y: number;
  z: number; // 0 to 1000 integer grid Z (vertical image axis)
  rotationY: number; // radians
  width: number; // 0 to 1000 integer grid width (or meters)
  height: number; // meters
  depth: number; // 0 to 1000 integer grid depth (or meters)
  roomLabel?: string;
}

export interface Spatial3DAnalysisResult {
  coordinateSystem?: 'grid_1000';
  slabWidth: number;
  slabDepth: number;
  zones?: Spatial3DZone[];
  walls: Spatial3DWall[];
  furniture: Spatial3DFurnitureItem[];
  analysisSummary: string;
  modelUsed: string;
}

