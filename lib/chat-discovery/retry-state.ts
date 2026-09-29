type UnknownRecord=Record<string,unknown>;

function asRecord(value:unknown):UnknownRecord|null {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as UnknownRecord:null;
}

export function resetDiscoveryRetryCheckpoint(
  candidate:{membershipState?:unknown;groupId?:unknown;discoveryCheckpoint?:unknown},
  now=Date.now(),
){
  const checkpoint=asRecord(candidate.discoveryCheckpoint);
  const final=asRecord(checkpoint?.final);
  const previous=asRecord(final?.result)||asRecord(checkpoint?.result);
  const result:UnknownRecord=previous?{...previous}:{};
  const joined=candidate.membershipState==='joined'||result.membershipState==='joined';
  const groupId=typeof candidate.groupId==='string'&&candidate.groupId.trim()
    ?candidate.groupId.trim()
    :typeof result.groupId==='string'?result.groupId:'';
  if(joined)result.membershipState='joined';
  if(groupId)result.groupId=groupId;
  return {
    attempts:0,
    startedAt:now,
    stageMs:{},
    ...(Object.keys(result).length?{result}:{}),
  };
}
