# Pascal Editor：下一代基于 Web 的开源 3D 建筑设计引擎

## 项目简介
**Pascal Editor** (GitHub: [pascalorg/editor](https://github.com/pascalorg/editor)) 是一个主打极简、高性能且开源的 **3D 建筑编辑器**，运行于现代 Web 浏览器中。它旨在解决传统建筑软件（如 AutoCAD、SketchUp、Revit）过于笨重、需要本地安装且协作/分享成本高昂的问题。

通过这个工具，用户可以在网页中从零开始设计整栋建筑：实时绘制墙体、生成楼板、放置门窗家具，并进行多楼层的空间管理（支持层叠、爆炸图、单层隔离显示）。整个项目无需注册账号或安装任何插件，通过本地存储实现无缝自动保存，为轻量级建筑建模和快速概念验证提供了前所未有的流畅体验。

## 核心特性与技术架构

Pascal Editor 在架构设计上展现出了极高的工程水平，采用时下最前沿的 Web 渲染与状态管理方案。

### 核心特性
- **实时 3D 绘图与 2D 底图模式**：支持 2D 顶视图草图绘制与 3D 实时渲染的无缝切换，墙体绘制自带网格吸附与正交捕捉。
- **自动化几何与 CSG 运算**：门窗等组件被放置到墙体上时，系统会自动利用 CSG（构造实体几何）进行布尔运算，实时在墙体上“挖洞”。
- **层级化建筑管理**：建立了一套严谨的空间层级体系：`Site (场地) -> Building (建筑) -> Level (楼层) -> Wall / Slab / Ceiling / Zone -> Item (物品/门窗)`。
- **模块化包管理**：不仅是一个独立应用，其渲染引擎作为独立的 npm 包 (`@pascal-app/viewer`) 发布，方便其他开发者集成到自己的应用中。

### 技术架构
项目使用 **Turborepo** 管理 Monorepo，主要分为三大模块：
1. **`apps/editor` (应用层)**：基于 **Next.js 16** 和 **React 19** 构建的用户界面。负责各种交互工具（如 SelectTool、WallTool 等）、图层可见性与面板状态管理（通过专属的 `useEditor` Zustand Store）。
2. **`@pascal-app/core` (核心逻辑与状态层)**：
   - 采用**扁平字典结构 (`Record<id, Node>`)**而非深层嵌套树来存储场景节点。这极大降低了数据更新时的深拷贝成本，提升了 React 的渲染性能。
   - 状态持久化方案：状态通过 `Zustand` 结合 `IndexedDB` 持久化，并使用 `Zundo` 实现高达 50 步的撤销/重做（Undo/Redo）。
   - **Dirty Nodes（脏节点）渲染循环**：摒弃了纯粹的声明式更新，采用 ECS（实体组件系统）的思想。当节点发生属性变化时（如修改墙体厚度），将其标记为 Dirty，在下一帧 `useFrame` 中仅针对脏节点重算几何体，避免了不必要的全局重绘。
3. **`@pascal-app/viewer` (渲染层)**：基于 **Three.js**、**React Three Fiber (R3F)**，并实验性地拥抱了 **WebGPU** 以实现超凡的渲染性能。内部建立了一个 `sceneRegistry` (场景注册表)，将逻辑 ID 快速映射为底层的 3D 对象 (`Object3D`)，实现状态与渲染实体的极速对应。

## 适用场景与目标用户

- **独立建筑师与室内设计师**：非常适合在项目的概念阶段进行快速体块推敲、平面图绘制和空间排布，摆脱了笨重传统软件的束缚。
- **游戏开发者**：可作为轻量级的关卡编辑器（Level Editor），用于快速搭建室内场景或建筑群的原型，并导出至游戏引擎。
- **PropTech（房地产科技）开发者**：需要为房产交易平台、数字孪生系统构建“线上看房”或“3D户型图”的研发团队，可以直接接入其 `@pascal-app/viewer` 库，节约大量自研 3D 引擎的时间。
- **3D 爱好者和学生**：无需学习陡峭的传统 CAD 曲线，即可进行 3D 建筑创作。

## 与同类项目对比

- **对比 SketchUp / AutoCAD**：SketchUp 提供了强大的自定义面片和复杂建模能力，但在 Web 端的高级功能往往需要付费闭源版本。Pascal Editor 更加垂直、轻量，完全开源，并且自带现代 Web 堆栈，天生适合二次开发。
- **对比 Sweet Home 3D**：Sweet Home 3D 是室内设计领域的开源老牌劲旅（基于 Java）。Pascal Editor 在 UI 现代化、Web 原生性能（WebGPU）以及前端生态（React/NPM）的契合度上具有压倒性优势。
- **对比 Archilogic 等商业平台**：Archilogic 提供成熟的建筑空间数字解析和可视化，但属于企业级闭源产品。Pascal Editor 填补了现代 Web 端高质量开源 3D 建筑编辑器的空白。

## 评价与思考

1. **扁平化状态与 "Dirty Flag" 的绝佳实践**：在基于 React 的 3D 编辑器中，最大的痛点往往是状态更新导致的组件级联重渲染 (Cascade Re-renders)。Pascal Editor 将场景树展平为字典，并借助 "Dirty Nodes" 队列，在每帧（`useFrame`）中命令式地去更新底层 Three.js 对象的 Geometry（几何体）。这种**数据响应式（Zustand）与命令式渲染（WebGL）相结合**的模式，是开发高帧率 React 3D 应用的教科书级范例。
2. **面向组合的解耦设计**：架构上明确剥离了 `core` (数据定义与计算)、`viewer` (纯展示与渲染) 和 `editor` (工具与交互)。这意味着你可以只拉取 `core` 来做纯后端的无头（Headless）几何计算，或者在移动端 React Native 项目中复用底层状态，具有极高的工程远见。
3. **CSG 的性能挑战与机遇**：目前对于墙体开洞采用了 CSG 运算。随着项目规模变大（多栋建筑、成百上千的窗户），实时布尔运算可能会成为 CPU/GPU 的瓶颈。未来如果能引入基于 Shader 的裁剪（Clipping）或更高级的 WebWorker 异步计算，将进一步提升其性能天花板。

## 上上手建议

如果你是一名想体验或参与开发的程序员，以下是快速上手的路径：

1. **本地环境准备**：需要 Node.js 环境。克隆仓库后，建议使用 `pnpm` 或 `npm` 安装依赖。由于项目采用了 Turborepo 构建，可以通过统一的指令快速启动。
2. **运行与体验**：
   ```bash
   git clone https://github.com/pascalorg/editor.git
   cd editor
   npm install
   npx turbo run dev
   ```
   然后访问 `localhost:3000` 即可在本地体验拥有极致流畅度的 3D 编辑器。
3. **源码阅读切入点**：
   - 首先阅读 `packages/core/src/store/useScene.ts`：理解整个世界的状态是如何被扁平化存储的。
   - 其次查看 `packages/viewer/src/systems/WallSystem.tsx`：这里展示了最核心的建筑元素（墙体）是如何响应数据变化并重新构建 3D 几何体的。
4. **集成到自己的项目**：如果你只想展示一个 3D 模型，可以直接查阅官方文档关于 npm 包 `@pascal-app/viewer` 的引入方式，向你的 React 项目中注入高性能的 3D 预览能力。