export function installDrawingRoutes(router) {
  router.addRoute({path:'/admin/drawing/:section?',name:'AdminDrawingManagement',component:()=>import('./drawing-view.js'),meta:{requiresAuth:true,requiresAdmin:true,title:'绘图管理'}});
}
