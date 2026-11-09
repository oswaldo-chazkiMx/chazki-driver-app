async function listarInvitacionesRed(cliente,soloPropias=false){
  const filas=[];
  for(let desde=0;;desde+=500){
    const {data,error}=await cliente.rpc("listar_invitaciones_red",{p_solo_propias:soloPropias}).range(desde,desde+499);
    if(error)throw new Error("No se pudieron cargar las invitaciones. Verifica invitaciones-estado.sql en Supabase: "+error.message);
    if(!Array.isArray(data))throw new Error("La lista de invitaciones devolvió una respuesta inválida.");
    filas.push(...data);
    if(data.length<500)return filas;
  }
}
function correoInvitacionHtml(x){
  const fecha=v=>esc(new Date(v).toLocaleString("es-MX"));
  const envio=x.correo_enviado_en?`Enviado por Supabase: ${fecha(x.correo_enviado_en)}`:"Sin envío de validación registrado";
  const validacion=x.correo_validado_en?`Correo validado: ${fecha(x.correo_validado_en)}`:x.cuenta_creada?"Correo pendiente de validar":"Sin cuenta registrada";
  return `<small>${envio}<br>${validacion}</small>`;
}
