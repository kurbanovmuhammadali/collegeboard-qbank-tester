const copy = value => structuredClone(value);
export const accountCacheKey = id => `qbank-account-v1:${id}`;
export function mergeHistory(remote, pending) {
  return [...new Map([...remote, ...pending].map(s => [s.id, s])).values()].sort((a,b) => b.ended-a.ended);
}

// Completed tests sync independently, so two devices cannot overwrite an entire history.
// Draft updates use compare-and-swap: a stale device cannot silently replace a newer draft.
export class AccountStore {
  constructor({client, userId, storage, onStatus=()=>{}, delay=10000}) {
    this.client=client; this.userId=userId; this.storage=storage; this.onStatus=onStatus;
    this.delay=delay; this.key=accountCacheKey(userId); this.pending=new Map();
    this.fingerprints=new Map(); this.state={history:[],active:null}; this.revision=0;
    this.exists=false; this.draftDirty=false; this.conflict=false; this.closed=false; this.loaded=false;
  }
  status(kind, text) {
    if(this.storageFailed&&kind==='pending'){kind='error';text='Device backup unavailable. Keep this page open until cloud sync completes.';}
    if(!this.closed)this.onStatus({kind,text});
  }
  persist() {
    try { this.storage.setItem(this.key, JSON.stringify({state:this.state, pending:[...this.pending.values()], revision:this.revision, exists:this.exists, draftDirty:this.draftDirty}));this.storageFailed=false; }
    catch { this.storageFailed=true;this.status('error','Device storage is full. Keep this page open and sync or export your history.'); }
  }
  async load() {
    let cached;
    try { cached=JSON.parse(this.storage.getItem(this.key)); } catch {}
    if(cached && Array.isArray(cached.pending) && Array.isArray(cached.state?.history)) {
      this.pending=new Map(cached.pending.map(s=>[s.id,s]));
    } else cached=null;
    const remote=[];
    for(let offset=0;;offset+=100) {
      const {data,error}=await this.client.from('qbank_sessions').select('session').eq('user_id',this.userId).order('id').range(offset,offset+99);
      if(error)throw error;
      remote.push(...data.map(r=>r.session));
      if(data.length<100)break;
    }
    const {data:draft,error}=await this.client.from('qbank_drafts').select('draft,revision').eq('user_id',this.userId).maybeSingle();
    if(error)throw error;
    if(this.closed)throw Error('Account changed.');
    this.revision=draft?.revision??0; this.exists=!!draft;
    this.draftDirty=!!cached?.draftDirty;
    this.conflict=this.draftDirty && (cached.revision!==this.revision || cached.exists!==this.exists);
    this.state={history:mergeHistory(remote,[...this.pending.values()]),active:this.draftDirty?cached.state.active:draft?.draft??null};
    for(const s of this.state.history)this.fingerprints.set(s.id,JSON.stringify(s));
    this.loaded=true;this.persist();
    this.status(this.conflict?'conflict':'synced',this.conflict?'Another device changed the saved test. Resolve it before continuing.':'History loaded from your account');
    if(this.pending.size||this.draftDirty)this.schedule();
    return copy(this.state);
  }
  save(state) {
    if(this.closed)return;
    let newResult=false;
    for(const s of state.history) {
      const json=JSON.stringify(s);
      if(this.fingerprints.get(s.id)!==json){this.pending.set(s.id,copy(s));this.fingerprints.set(s.id,json);newResult=true;}
    }
    if(JSON.stringify(state.active)!==JSON.stringify(this.state.active)){this.draftDirty=true;this.draftGeneration=(this.draftGeneration||0)+1;}
    this.state=copy(state); this.persist();
    if(this.pending.size||this.draftDirty) {
      if(!this.conflict)this.status('pending','Changes saved on this device · syncing');
      this.schedule(newResult?0:this.delay);
    }
  }
  schedule(delay=this.delay) {
    if(this.closed || this.timer)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.flush();},delay);
  }
  async flush() {
    if(this.closed)return false;
    if(this.inFlight){await this.inFlight;return this.pending.size||this.draftDirty?this.flush():!this.conflict;}
    clearTimeout(this.timer);this.timer=null;
    this.inFlight=this.write();
    try { return await this.inFlight; } finally { this.inFlight=null; }
  }
  async write() {
    try {
      const sent=[...this.pending.values()].map(copy);
      for(const s of sent) {
        if(this.closed)return false;
        const {error}=await this.client.from('qbank_sessions').upsert({user_id:this.userId,id:s.id,session:s,updated_at:new Date().toISOString()},{onConflict:'user_id,id'});
        if(error)throw error;
        if(JSON.stringify(this.pending.get(s.id))===JSON.stringify(s))this.pending.delete(s.id);
      }
      if(this.draftDirty && !this.conflict && !this.closed) {
        const generation=this.draftGeneration||0;
        const row={user_id:this.userId,draft:copy(this.state.active),revision:this.revision+1,updated_at:new Date().toISOString()};
        const query=this.exists
          ?this.client.from('qbank_drafts').update(row).eq('user_id',this.userId).eq('revision',this.revision).select('revision')
          :this.client.from('qbank_drafts').insert(row).select('revision');
        const {data,error}=await query;
        if(error?.code==='23505' || (!error && !data?.length))this.conflict=true;
        else if(error)throw error;
        else {this.revision=data[0].revision;this.exists=true;if(generation===(this.draftGeneration||0))this.draftDirty=false;}
      }
      if(this.closed)return false;
      this.persist();
      if(this.conflict){this.status('conflict','Another device changed the saved test. Resolve it before continuing.');return false;}
      const dirty=this.pending.size||this.draftDirty;
      this.status(dirty?'pending':'synced',dirty?'Changes saved on this device · syncing':'All changes saved to your account');
      if(dirty)this.schedule();
      return !dirty;
    } catch(error) {
      this.persist();this.status('error','Cloud sync failed. Changes remain on this device. Retry when connected.');
      return false;
    }
  }
  async reloadCloudDraft() {
    const {data,error}=await this.client.from('qbank_drafts').select('draft,revision').eq('user_id',this.userId).maybeSingle();
    if(error)throw error;
    if(this.closed)throw Error('Account changed.');
    this.state.active=data?.draft??null;this.revision=data?.revision??0;this.exists=!!data;
    this.draftDirty=false;this.conflict=false;this.persist();
    this.status('synced','Saved test reloaded from your account');
    return copy(this.state.active);
  }
  async refreshHistory() {
    const remote=[];
    for(let offset=0;;offset+=100) {
      const {data,error}=await this.client.from('qbank_sessions').select('session').eq('user_id',this.userId).order('id').range(offset,offset+99);
      if(error)throw error;
      remote.push(...data.map(r=>r.session));if(data.length<100)break;
    }
    if(this.closed)throw Error('Account changed.');
    this.state.history=mergeHistory(remote,[...this.pending.values()]);
    for(const s of this.state.history)this.fingerprints.set(s.id,JSON.stringify(s));
    this.persist();return copy(this.state.history);
  }
  dispose({clearCache=false}={}) {
    this.closed=true;clearTimeout(this.timer);this.timer=null;
    // Do not erase pending work if sign-in failed before it could be uploaded.
    if(clearCache && this.loaded && !this.pending.size && !this.draftDirty)this.storage.removeItem(this.key);
  }
}
