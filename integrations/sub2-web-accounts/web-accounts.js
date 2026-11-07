const WEB_CLIENT = 'app_2SKx67EdpoN0G6j64rFvigXD';
export function parseWebImports(text) {
  let value;
  try { value = JSON.parse(text); } catch { value = {access_token:text.trim()}; }
  const rows = Array.isArray(value) ? value : Array.isArray(value?.accounts) ? value.accounts : [value];
  if (!rows.length || rows.length > 100) throw new Error('每批支持 1–100 个账号');
  return rows.map(row => {
    const source = {...row, ...(row?.credentials || {}), ...(row?.tokens || {})};
    const token = String(source.access_token || source.accessToken || '').trim();
    if (!token || /\s/.test(token)) throw new Error('文件中缺少有效的 access_token');
    let claims = {};
    try { claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch {}
    const client = source.client_id || claims.client_id || '';
    if (source.source_type === 'codex' || client === 'app_EMoamEEZ73f0CkXaXp7hrann' || claims.client_id === 'app_EMoamEEZ73f0CkXaXp7hrann') throw new Error('检测到 Codex 授权，请使用账号管理原有的 Codex 导入入口');
    const email = source.email || claims['https://api.openai.com/profile']?.email || claims.email || '';
    return {email:String(email), credentials:{source_type:'web',client_id:client || WEB_CLIENT,access_token:token,
      ...(source.refresh_token ? {refresh_token:source.refresh_token} : {}),
      ...(source.id_token ? {id_token:source.id_token} : {}),
      ...(source.expires_at || claims.exp ? {expires_at:source.expires_at || claims.exp} : {}),
      ...(email ? {email:String(email)} : {}),
      ...(source.fp ? {web_fingerprint:source.fp} : {}),
      model_mapping:{'gpt-image-2':'gpt-image-2'}}};
  });
}

export async function openWebAccounts({api, onApplied}) {
  if (document.querySelector('.web-accounts-dialog')) return;
  const opener=document.activeElement, dialog=document.createElement('dialog');
  dialog.className='web-accounts-dialog';
  dialog.setAttribute('aria-labelledby','web-accounts-title');
  dialog.innerHTML=`<header><div><small>统一账号管理</small><h2 id="web-accounts-title">ChatGPT Web 账号</h2></div><button type="button" data-close aria-label="关闭">×</button></header>
    <p class="wa-intro">上传网页授权文件，使用中转站的分组与账单。Codex 账号继续从原有入口管理。</p>
    <section class="wa-import"><h3>导入授权</h3><label class="wa-files">选择 JSON 文件<input type="file" accept=".json,application/json" multiple></label>
    <textarea rows="3" aria-label="Web 授权内容" placeholder="也可以粘贴授权 JSON 或 access token；支持批量 JSON 数组" autocomplete="off" spellcheck="false"></textarea>
    <div class="wa-settings"><label>绘图分组<select data-group><option value="">正在加载…</option></select></label><label>访问代理<select data-proxy><option value="">直连</option></select></label></div>
    <p class="wa-note">新账号先保存为停用。检查授权与额度后，再开启调度；同邮箱的 Web 与 Codex 会分别保存。</p>
    <button type="button" class="wa-primary" data-import disabled>导入并保存</button></section>
    <section><div class="wa-list-title"><h3>Web 账号</h3><button type="button" data-refresh>刷新列表</button></div><div class="wa-list"></div></section>
    <p class="wa-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);dialog.showModal();
  const q=s=>dialog.querySelector(s), status=q('.wa-status');
  let busy=false, accounts=[], groups=[];
  function close(){if(busy)return;dialog.remove();opener?.focus();}
  q('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  async function list(){
    const rows=[];
    for(let page=1;page<=100;page++){
      const data=await api.accounts.list(page,100,{platform:'openai',type:'oauth'});
      const items=data.items || []; rows.push(...items.filter(a=>a.credentials?.source_type==='web' || a.credentials?.client_id===WEB_CLIENT));
      if(items.length<100 || page*100 >= data.total) break;
    }
    accounts=rows;render();
  }
  function render(){
    const target=q('.wa-list');target.replaceChildren();
    if(!accounts.length){target.textContent='还没有 Web 账号。导入后会显示在这里，也会出现在主账号列表。';return;}
    for(const account of accounts){
      const card=document.createElement('article'), title=document.createElement('strong'), detail=document.createElement('p'), controls=document.createElement('div');
      title.textContent=account.credentials?.email || account.name.replace(/^\[Web\]\s*/, '');
      const quota=account.extra?.web_image_usage, currentGroup=(account.group_ids || []).map(id=>groups.find(g=>g.id===id)?.name || '#'+id).join('、');
      detail.textContent=`${account.schedulable && account.status==='active'?'已启用':'已停用'} · Image 2 · ${currentGroup || '未分组'}${quota?.remaining != null?' · 剩余 '+quota.remaining+' 张':''}`;
      const probe=document.createElement('button');probe.type='button';probe.textContent='检查授权与额度';
      probe.onclick=async()=>{
        if(busy)return;busy=true;probe.disabled=true;status.textContent='正在读取 Web 授权与图片额度…';
        try{
          const usage=await api.accounts.getUsage(account.id,'active',true);
          if(usage.error) throw new Error(usage.error);
          const web=usage.web_image_usage;
          if(!web) throw new Error('未返回 Web 额度信息');
          account.extra={...(account.extra||{}),web_image_usage:web};
          status.textContent=web.remaining==null?'授权可读取；上游未提供图片余量。模型是否可用仍以实际生成结果为准。':`授权可读取，剩余 ${web.remaining} 张${web.reset_at?'，重置时间：'+web.reset_at:''}。`;
          render();
        }catch{status.textContent='读取失败：请检查授权是否过期、代理和上游状态。账号不会因此被自动删除。';}
        finally{busy=false;probe.disabled=false;}
      };
      const enabled=account.schedulable && account.status==='active';
      const toggle=document.createElement('button');toggle.type='button';toggle.textContent=enabled?'停用':'启用';
      toggle.onclick=async()=>{
        if(busy)return;busy=true;toggle.disabled=true;
        try{
          if(!enabled && account.status!=='active')await api.accounts.update(account.id,{status:'active'});
          await api.accounts.setSchedulable(account.id,!enabled);
          await list();await onApplied?.();status.textContent='调度状态已保存。';
        }catch{status.textContent='保存失败，请刷新列表后重试。';}
        finally{busy=false;toggle.disabled=false;}
      };
      controls.append(probe,toggle);card.append(title,detail,controls);target.append(card);
    }
  }
  q('input[type=file]').onchange=async e=>{
    try{const rows=[];for(const file of e.target.files)rows.push(...parseWebImports(await file.text()));q('textarea').value=JSON.stringify(rows.map(r=>({...r.credentials,email:r.email})),null,2);status.textContent=`已读取 ${rows.length} 个 Web 账号，请选择分组后保存。`;}catch(e){status.textContent=e.message;}
  };
  q('[data-import]').onclick=async()=>{
    if(busy)return;
    let rows;try{rows=parseWebImports(q('textarea').value);}catch(e){status.textContent=e.message;return;}
    const group=Number(q('[data-group]').value);if(!group){status.textContent='请选择允许绘图的分组。';return;}
    busy=true;q('[data-import]').disabled=true;let saved=0;
    try{
      await list();
      for(const row of rows){
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.credentials.access_token));
        const fingerprint=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
        row.credentials.web_import_fingerprint=fingerprint;
        const existing=accounts.find(a=>(row.email && a.credentials?.email===row.email) || a.credentials?.web_import_fingerprint===fingerprint);
        const payload={name:'[Web] '+(row.email || fingerprint.slice(0,12)),credentials:row.credentials,group_ids:[group],proxy_id:Number(q('[data-proxy]').value)||null,confirm_mixed_channel_risk:true};
        let result;
        if(existing)result=await api.accounts.update(existing.id,{...payload,proxy_id:payload.proxy_id || 0});
        else result=await api.accounts.create({...payload,platform:'openai',type:'oauth',status:'active',schedulable:false,concurrency:2000,priority:50,rate_multiplier:1,skip_default_group_bind:true,skip_mixed_channel_check:true});
        if(result)accounts.push(result);saved++;
      }
      q('textarea').value='';q('input[type=file]').value='';await list();await onApplied?.();status.textContent=`已保存 ${saved} 个 Web 账号。可以检查额度后开启调度。`;
    }catch{status.textContent=`已保存 ${saved} 个账号，其余未确认。请刷新后重试，已识别账号会更新授权。`;}
    finally{busy=false;q('[data-import]').disabled=false;}
  };
  q('[data-refresh]').onclick=()=>{if(!busy)list().catch(()=>status.textContent='加载失败，请重试。');};
  try{
    const results=await Promise.all([api.groups.getAll(),api.proxies.getAll()]);
    groups=results[0].filter(g=>g.platform==='openai'&&g.allow_image_generation&&g.status==='active');
    q('[data-group]').replaceChildren(new Option('请选择绘图分组',''),...groups.map(g=>new Option(g.name,String(g.id))));
    for(const p of results[1])q('[data-proxy]').append(new Option(p.name,String(p.id)));
    await list();q('[data-import]').disabled=!groups.length;
    if(!groups.length)status.textContent='请先在中转站建立允许图片生成的 OpenAI 分组。';
  }catch{status.textContent='加载账号配置失败，请关闭后重试。';}
}
