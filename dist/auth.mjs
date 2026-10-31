const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function signupOutcome(data) {
  if(data?.session)return 'signedin';
  if(Array.isArray(data?.user?.identities)&&data.user.identities.length===0)return 'existing';
  return 'confirmation';
}
export function callbackNotice(hash,search='') {
  const fragment=new URLSearchParams(hash.replace(/^#/,'')),query=new URLSearchParams(search.replace(/^\?/,''));
  const code=fragment.get('error_code')||query.get('error_code');
  const error=fragment.get('error')||query.get('error');
  if(code==='otp_expired')return 'This email link has expired or has already been used. Try signing in. If needed, request a new confirmation or password reset email.';
  if(code||error)return 'This email link could not be completed. Request a new confirmation or password reset email and use the newest link.';
  return '';
}
export function loginErrorNotice(error) {
  if(error?.code==='invalid_credentials'||/invalid login credentials/i.test(error?.message||''))return 'The email or password was not accepted. If you registered this email before, use your original password or choose Forgot password. Registering again does not change your password.';
  if(error?.code==='email_not_confirmed')return 'Confirm your email before signing in. You can request a new confirmation email below.';
  return error?.message||'Could not complete this request. Try again.';
}
export function assertBrowserKey(key) {
  if(typeof key!=='string')throw Error('A public Supabase key is required.');
  if(key.startsWith('sb_publishable_')&&key.length>20)return;
  try {
    const payload=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if(payload.role==='anon')return;
  } catch {}
  throw Error('Only a publishable or legacy anon key may be used in the browser.');
}
export async function mountAuth({onSignedIn,onSignedOut,beforeSignOut,onDemo}) {
  const config=window.QBANK_CONFIG||{};
  const root=document.getElementById('auth-root');
  let mode='signin', email='', currentId=null, epoch=0;
  let recovery=new URLSearchParams(location.hash.slice(1)).get('type')==='recovery';
  const linkNotice=callbackNotice(location.hash,location.search);
  const configured=!!config.supabaseUrl && !!config.supabasePublishableKey;
  const redirect=location.origin+location.pathname;
  let client;
  function message(text,error=false) {
    const el=root.querySelector('[data-auth-message]');
    if(el){el.textContent=text;el.classList.toggle('error',error);el.setAttribute('role',error?'alert':'status');}
  }
  function show(next=mode,notice='') {
    mode=next;document.body.classList.add('auth-mode');
    const signup=mode==='signup',reset=mode==='reset',update=mode==='update',confirm=mode==='confirm';
    const title=signup?'Create your account':reset?'Reset your password':update?'Choose a new password':confirm?'Check your email':'Sign in';
    root.innerHTML=`<div class="auth-brand"><strong>QBank</strong><span>SAT Reading &amp; Writing</span></div><div class="auth-layout"><section class="auth-intro"><p class="eyebrow">YOUR PRACTICE, IN ONE PLACE</p><h1>Build a stronger<br>practice habit.</h1><p>Choose your question mix, work through a focused test, and see which skills need attention.</p><ul><li>Up to 30 questions per test</li><li>Progress and analytics in your account</li><li>Practice that adjusts as you improve</li></ul></section><section class="auth-card" aria-labelledby="auth-title"><h2 id="auth-title">${title}</h2><p class="auth-description">${signup?'Save your tests and track your progress across devices.':reset?'We’ll email you a link to choose a new password.':update?'Use at least 8 characters.':confirm?'Follow the confirmation link, then return to sign in.':'Continue your practice and review your progress.'}</p>${!configured?'<div class="notice">Account setup is not connected yet. Configure Supabase to enable registration and cloud history.</div>':''}<p data-auth-message role="status" class="auth-message">${escape(notice)}</p><form id="auth-form">${!update?`<label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" value="${escape(email)}" required ${confirm?'readonly':''} ${!configured?'disabled':''}>`:''}${!reset&&!confirm?`<label for="auth-password">${update?'New password':'Password'}</label><input id="auth-password" name="password" type="password" autocomplete="${signup||update?'new-password':'current-password'}" minlength="${signup||update?8:1}" ${signup||update?'maxlength="128"':''} required ${!configured?'disabled':''}>`:''}${signup||update?'<label for="auth-confirm">Confirm password</label><input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required>':''}<button class="button primary auth-submit" type="submit" ${!configured?'disabled':''}>${signup?'Create account':reset?'Send reset link':update?'Update password':confirm?'Resend confirmation':'Sign in'}</button></form><div class="auth-links">${mode==='signin'?'<button data-auth-mode="reset">Forgot password?</button><p>New to QBank? <button data-auth-mode="signup">Create an account</button></p>':'<button data-auth-mode="signin">Back to sign in</button>'}</div>${!configured?'<button class="button auth-demo" data-auth-demo>Try the local demo</button>':''}<p class="auth-footnote">Your practice history is private to your account.</p></section></div><footer class="auth-footer">Independent SAT practice · Not affiliated with UWorld or College Board</footer>`;
    if(mode==='signin')root.querySelector('.auth-links').insertAdjacentHTML('beforeend','<button data-auth-mode="confirm">Resend confirmation email</button>');
    root.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>{email=root.querySelector('[name="email"]')?.value.trim()||email;show(b.dataset.authMode);});
    root.querySelector('[data-auth-demo]')?.addEventListener('click',()=>{document.body.classList.remove('auth-mode');root.innerHTML='';onDemo();});
    root.querySelector('form')?.addEventListener('submit',submit);
  }
  async function handleSession(session,{force=false}={}) {
    if(recovery){if(mode!=='update'){currentId=null;onSignedOut();show('update');}return;}
    if(!force && (session?.user.id??null)===currentId)return;
    const token=++epoch;
    currentId=session?.user.id??null;
    if(!session){onSignedOut();show('signin');return;}
    document.body.classList.add('auth-mode');
    root.innerHTML='<div class="auth-loading" role="status">Loading your practice history…</div>';
    try {
      await onSignedIn({client,user:session.user});
      if(token!==epoch)return;
      document.body.classList.remove('auth-mode');root.innerHTML='';
    } catch {
      if(token!==epoch)return;
      root.innerHTML='<section class="auth-card auth-load-error"><h2>Couldn’t load your account</h2><p>Your cloud history is unavailable. Check your connection and try again.</p><button class="button primary" data-auth-retry>Retry</button><button class="button" data-auth-signout>Sign out</button><p role="alert" data-auth-message></p></section>';
      root.querySelector('[data-auth-retry]').onclick=()=>handleSession(session,{force:true});
      root.querySelector('[data-auth-signout]').onclick=()=>signOut();
    }
  }
  async function submit(event) {
    event.preventDefault();if(!client)return;
    const form=event.currentTarget,button=form.querySelector('[type="submit"]');
    email=form.elements.email?.value.trim()||email;
    const password=form.elements.password?.value;
    if(form.elements.confirm && password!==form.elements.confirm.value){message('The passwords do not match.',true);return;}
    button.disabled=true;message('');
    try {
      if(mode==='signup') {
        const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:redirect}});
        if(error)throw error;
        form.reset();
        const outcome=signupOutcome(data);
        if(outcome==='signedin')await handleSession(data.session);
        else if(outcome==='existing')show('signin','This email may already be registered. Sign in or choose Forgot password. Registering again does not change an existing password.');
        else show('confirm','Check your email for the newest confirmation link. If you already have an account, sign in or reset your password; signing up again does not change it.');
      } else if(mode==='signin') {
        const {data,error}=await client.auth.signInWithPassword({email,password});
        if(error)throw error;form.reset();await handleSession(data.session);
      } else if(mode==='reset') {
        const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:redirect});
        if(error)throw error;message('If an account uses this address, we’ll send a password reset link.');
      } else if(mode==='confirm') {
        const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:redirect}});
        if(error)throw error;message('If confirmation is needed, another email will arrive shortly.');
      } else if(mode==='update') {
        const {error}=await client.auth.updateUser({password});
        if(error)throw error;form.reset();recovery=false;
        const {data}=await client.auth.getSession();await handleSession(data.session,{force:true});
      }
    } catch(error) { message(loginErrorNotice(error),true); }
    finally {button.disabled=false;}
  }
  async function signOut() {
    if(!await beforeSignOut())return;
    const {error}=await client.auth.signOut({scope:'local'});
    if(error){message('Sign out failed. Try again.',true);return;}
    ++epoch;currentId=null;recovery=false;onSignedOut({clearCache:true});show('signin');
  }
  show('signin',linkNotice);
  if(!configured)return {client:null,signOut:()=>{}};
  try {
    assertBrowserKey(config.supabasePublishableKey);
    if(!window.supabase?.createClient)throw Error('Supabase SDK is unavailable.');
    client=window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    root.querySelector('[type="submit"]').disabled=true;
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY')recovery=true;
      // Keep Supabase calls outside its synchronous auth callback/lock.
      // Read the current session, not an event snapshot that may already be stale.
      setTimeout(async()=>{const {data,error}=await client.auth.getSession();if(!error)await handleSession(data.session);},0);
    });
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    if(data.session)await handleSession(data.session);
    else if(recovery){recovery=false;show('signin','This password reset link could not be used. Request a new link.');}
    else show('signin',linkNotice);
  } catch {message('Could not connect to Supabase. Check the configuration and your connection.',true);}
  return {client,signOut};
}
