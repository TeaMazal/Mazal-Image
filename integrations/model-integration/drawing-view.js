import {h, r as ref, o as onMounted, a as onUnmounted, w as watch, Z as useRoute, $ as useRouter} from './vendor-vue-DxkmtFFM.js';
import {f as http} from './index-BnKfrCJM.js';
import {_ as AppLayout} from './AppLayout.vue_vue_type_script_setup_true_lang-DLz0e2ay.js';
import {DrawingWorkspace} from './drawing-workspace.js';

export default {
  name:'DrawingManagement',
  setup(){
    const root=ref(null),route=useRoute(),router=useRouter();let workspace;
    onMounted(()=>{workspace=new DrawingWorkspace(root.value,http,router);workspace.open(String(route.params.section||'overview'));});
    watch(()=>route.params.section,section=>workspace?.open(String(section||'overview')));
    onUnmounted(()=>workspace?.destroy());
    return ()=>h(AppLayout,null,{default:()=>h('div',{ref:root,class:'drawing-management'})});
  }
};
