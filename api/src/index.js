'use strict'

const { SDK, LogType }  = require('tencentcloud-serverless-nodejs')

const stableDocker2 = "v2.0-r10"
const stableVersion2 = "2.0.274"
const stableDocker3 = "v3.0-r7"
const stableVersion3 = "3.0.164"
const stableDocker4 = "v4.0.139"
const stableVersion4 = "v4.0.139"

const dockerImage = "ossrs/srs"
const dockerMirror = "registry.cn-hangzhou.aliyuncs.com/ossrs/srs"

exports.main_handler = async (event, context) => {
  let q = event.queryString || {}
	let version = q.version? q.version :  "v0.0.0"

  // Initialize system.
  await initialize()

	// Transform version to vx.x.x
  if (version.indexOf('v') !== 0) {
		version = "v" + version
	}
  if (version.indexOf('.') === -1) {
		version += ".0.0"
	}

	// Build response.
  let res = {
    stable_version: stableVersion3,
    stable_docker: stableDocker3,
  }

  if (version.indexOf('v2.') === 0) {
    res.match_version = stableVersion2
    res.match_docker = stableDocker2
  } else if (version.indexOf('v3.') === 0) {
    res.match_version = stableVersion3
    res.match_docker = stableDocker3
  } else if (version.indexOf('v4.') === 0) {
    res.match_version = stableVersion4
    res.match_docker = stableDocker4
  } else if (version.indexOf('v5.') === 0) {
    res.match_version = stableVersion4
    res.match_docker = stableDocker4
  } else {
    res.match_version = stableVersion3
    res.match_docker = stableDocker3
  }
	res.match_docker_image = dockerImage + ':' + res.match_docker
	res.match_docker_mirror = dockerMirror + ':' + res.match_docker
	res.stable_docker_image = dockerImage + ':' + res.stable_docker
	res.stable_docker_mirror = dockerMirror + ':' + res.stable_docker

  q.rip = event.headers && event.headers['X-Forwarded-For']

  // Call the db SCF to write to MySQL.
  let r0 = null
  if (q.id && q.version) {
    let r = r0 = await new SDK().invoke({functionName: process.env.DB_INTERNAL_SERVICE, logType: LogType.Tail, data: {
      path: '/db-internal/v1/versions', queryString: q, res: res,
    }})

    // Modify the response body of api-service SCF.
    let rr = r.Result && r.Result.RetMsg && JSON.parse(r.Result.RetMsg)
    if (q.feedback) res.db = (!rr || rr.errorCode)? null : rr
  }

  // Call the im-service SCF to notify all users.
  let r1 = null
  if (q.id && q.version) {
    let r = r1 = await new SDK().invoke({functionName: process.env.IM_INTERNAL_SERVICE, logType: LogType.Tail, data: {
      path: '/im-internal/v1/send_group_msg', queryString: {to:process.env.IM_GROUP_SYSLOG}, 
      body: JSON.stringify({msg: JSON.stringify({api: new Date().getTime(), q: q, res: res})}),
    }})

    // Modify the response body of api-service SCF.
    let rr = r.Result && r.Result.RetMsg && JSON.parse(r.Result.RetMsg)
    if (q.feedback) res.im = (!rr || rr.errorCode)? null : rr
  }

  console.log(`SRS id=${q.id}, version=${version}, eip=${q.eip}, rip=${q.rip}, res=`, res, ', scf=', r0, r1, ', by', event)
  return res
}

global.initialized

async function initialize() {
  if (global.initialized) {
    return
  }
  global.initialized = true

  // Call the db SCF to get system users.
  let r0 = await new SDK().invoke({functionName: process.env.DB_INTERNAL_SERVICE, logType: LogType.Tail, data: {
    path: '/db-internal/v1/users',
  }})
  let r1 = r0.Result && r0.Result.RetMsg && JSON.parse(r0.Result.RetMsg)
  console.log('users', r1.users)

  // Call the im SCF to register users to IM, then create group and join.
  r1.users.map(async function(user) {
    await new SDK().invoke({functionName: process.env.IM_INTERNAL_SERVICE, logType: LogType.Tail, data: {
      path: '/im-internal/v1/account_import', queryString: {user: user}
    }})
    await new SDK().invoke({functionName: process.env.IM_INTERNAL_SERVICE, logType: LogType.Tail, data: {
      path: '/im-internal/v1/enter_room', queryString: {user: user, id: process.env.IM_GROUP_SYSLOG, type: process.env.IM_GROUP_TYPE}
    }})
  })
}

