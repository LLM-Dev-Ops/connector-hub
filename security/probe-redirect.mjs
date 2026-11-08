import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const redirectCases=['301','302','303','307','308','same-origin-307','valid','inactive','unavailable','malformed','scope','issuer','audience','expired'];
export async function probeRedirects(root, names=redirectCases) {
 const {validateOAuth}=await import(pathToFileURL(resolve(root,'packages/agents/src/auth/validators/oauth-validator.ts')));
 const holdout=[],anchors=[];
 for(const name of names) {
  let destinationRequests=0,tokenForwarded=false,clientAuthForwarded=false;
  const token=`synthetic-token-${name}`,payload={active:true,sub:'fixture',iss:'https://issuer.invalid',aud:'connector',scope:'read',exp:Math.floor(Date.now()/1000)+3600};
  const destination=async(req,res)=>{
   let body='';for await(const chunk of req)body+=chunk;
   destinationRequests++;tokenForwarded=body.includes(token);clientAuthForwarded=Boolean(req.headers.authorization);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));
  };
  const target=createServer(destination);await new Promise(r=>target.listen(0,'127.0.0.1',r));
  const redirects=/^30[12378]$/.test(name)||name==='same-origin-307';
  let origin;
  const source=createServer(async(req,res)=>{
   if(req.url==='/destination'){await destination(req,res);return;}
   req.resume();
   if(redirects){res.writeHead(name==='same-origin-307'?307:Number(name),{Location:name==='same-origin-307'?`${origin}/destination`:`http://127.0.0.1:${target.address().port}/destination`});res.end();return;}
   if(name==='unavailable'){res.writeHead(503);res.end('{}');return;}
   if(name==='malformed'){res.end('{broken');return;}
   const body={...payload};
   if(name==='inactive')body.active=false;
   if(name==='scope')body.scope='other';
   if(name==='issuer')body.iss='https://other.invalid';
   if(name==='audience')body.aud='other';
   if(name==='expired')body.exp-=7200;
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));
  });
  await new Promise(r=>source.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${source.address().port}`;
  try {
   const result=await validateOAuth(token,{introspectionEndpoint:`${origin}/introspect`,clientId:'synthetic-client',clientSecret:'synthetic-secret-fixture-only',timeoutMs:1000,expectedIssuer:'https://issuer.invalid',expectedAudience:'connector',requiredScopes:['read']});
   const expectedStatus={valid:'valid',inactive:'revoked',unavailable:'unknown',malformed:'unknown',scope:'scope_insufficient',issuer:'issuer_mismatch',audience:'audience_mismatch',expired:'expired'}[name];
   const passed=redirects?!result.valid&&destinationRequests===0:result.valid===(name==='valid')&&result.status===expectedStatus&&destinationRequests===0;
   (redirects?holdout:anchors).push({id:name,passed,valid:result.valid,status:result.status,destinationRequests,tokenForwarded,clientAuthForwarded});
  }finally{for(const server of [source,target]){server.closeAllConnections();await new Promise(r=>server.close(r));}}
 }
 return {holdout,anchors};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await probeRedirects(resolve(process.argv[2]))));
