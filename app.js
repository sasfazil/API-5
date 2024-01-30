const express = require('express')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null
const initializeDBandServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server started running')
    })
  } catch (e) {
    console.log(`Database error: ${e.message}`)
  }
}
initializeDBandServer()

const verifyJWT = async (req, res, next) => {
  let jwtToken
  const authHeader = req.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    res.status(401)
    res.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET_KEY', async (error, payload) => {
      if (error) {
        res.status(401)
        res.send('Invalid JWT Token')
      } else {
        req.username = payload.username
        next()
      }
    })
  }
}

const getUserId = async (req, res, next) => {
  const {username} = req
  const userIdquery = `
    SELECT
    user_id
    FROM
    user
    WHERE
    username = '${username}'
    `
  const {user_id} = await db.get(userIdquery)
  req.user_id = user_id
  next()
}

const getFollowing = async (req, res, next) => {
  const {user_id} = req
  const followingQuery = `
    SELECT
      following_user_id
    FROM
      follower
    WHERE
      follower_user_id = ${user_id}
    `
  const followDb = await db.all(followingQuery)
  const followIds = followDb.map(each => each.following_user_id)
  req.followIds = followIds
  next()
}

const getFollowers = async (req, res, next) => {
  const {user_id} = req
  const followingQuery = `
    SELECT
      follower_id
    FROM
      follower
    WHERE
      follower_user_id = ${user_id}
    `
  const followDb = await db.all(followingQuery)
  const followerIds = followDb.map(each => each.follower_id)
  req.followerIds = followerIds
  next()
}

const checkTweet = async (req, res, next) => {
  const {followIds} = req
  const {tweetId} = req.params
  const getTweetQuery = `
      SELECT
        tweet_id
      FROM
        tweet 
      WHERE
        user_id IN (${followIds.join()})
      `
  const getTweetDb = await db.all(getTweetQuery)
  const getTweetIds = getTweetDb.map(each => each.tweet_id)

  if (getTweetIds.includes(parseInt(tweetId))) {
    next()
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
}

const createUser = async (req, res, next) => {
  const {username, password, name, gender} = req.body
  const userQuery = `
  SELECT 
    *
  FROM
    user
  WHERE
    username = '${username}'
  `
  const userDb = await db.get(userQuery)
  if (userDb !== undefined) {
    res.status(400)
    res.send('User already exists')
  } else {
    if (password.length < 6) {
      res.status(400)
      res.send('Password is too short')
    } else {
      next()
    }
  }
}

const findUser = async (req, res, next) => {
  const {username, password} = req.body
  const findUserQuery = `
  SELECT 
  *
  FROM
  user
  WHERE
    username = '${username}'
  `
  const userDb = await db.get(findUserQuery)

  if (userDb === undefined) {
    res.status(400)
    res.send('Invalid user')
  } else {
    const comparePass = await bcrypt.compare(password, userDb.password)
    if (comparePass) {
      next()
    } else {
      res.status(400)
      res.send('Invalid password')
    }
  }
}

app.post('/register/', createUser, async (req, res) => {
  const {username, password, name, gender} = req.body
  const hashPass = await bcrypt.hash(password, 10)
  const registerQuery = `
  INSERT
  INTO
    user(username,password,name,gender)
  VALUES(
    '${username}',
    '${hashPass}',
    '${name}',
    '${gender}'
  )
  `
  await db.run(registerQuery)
  res.status(200)
  res.send('User created successfully')
})

app.post('/login/', findUser, async (req, res) => {
  const {username} = req.body
  const payload = {username: username}
  const jwtToken = jwt.sign(payload, 'SECRET_KEY')
  res.send({jwtToken})
})

app.get(
  '/user/tweets/feed/',
  verifyJWT,
  getUserId,
  getFollowing,
  async (req, res) => {
    const {followIds} = req
    const getTweetQuery = `
  SELECT
    user.username,
    tweet.tweet,
    tweet.date_time
  FROM
    user INNER JOIN tweet ON user.user_id = tweet.user_id
  WHERE
    user.user_id IN (${followIds.join(',')})
  ORDER BY
  tweet.date_time DESC
  LIMIT 4
  `
    const getTweetDb = await db.all(getTweetQuery)
    res.send(
      getTweetDb.map(each => ({
        username: each.username,
        tweet: each.tweet,
        dateTime: each.date_time,
      })),
    )
  },
)

app.get(
  '/user/following/',
  verifyJWT,
  getUserId,
  getFollowing,
  async (req, res) => {
    const {followIds} = req
    const getTweetQuery = `
    SELECT
      name
    FROM
      user
    WHERE
      user_id IN (${followIds.join()})
    `
    const getTweetDb = await db.all(getTweetQuery)
    res.send(getTweetDb)
  },
)

app.get(
  '/user/followers/',
  verifyJWT,
  getUserId,
  getFollowers,
  async (req, res) => {
    const {followerIds} = req
    const getTweetQuery = `
    SELECT
      *
    FROM
      user
    WHERE
      user_id IN (${followerIds.join()})
    `
    const getTweetDb = await db.all(getTweetQuery)
    res.send(getTweetDb.map(each => ({name: each.name})))
  },
)

app.get(
  '/tweets/:tweetId/',
  verifyJWT,
  getUserId,
  getFollowing,
  checkTweet,
  async (req, res) => {
    const {tweetId} = req.params
    const reqTweetLikes = `
    SELECT
      tweet.tweet,
      COUNT(like.like_id) AS likes,
      tweet.date_time
    FROM
      tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE
      tweet.tweet_id = ${tweetId}
    `
    const [reqTweetLikeDb] = await db.all(reqTweetLikes)
    const reqTweetreplie = `
    SELECT
      COUNT(reply.reply_id) AS replies
    FROM
      reply INNER JOIN tweet ON reply.tweet_id = tweet.tweet_id
    WHERE
      tweet.tweet_id = ${tweetId}
    `
    const [reqTweetReplieDb] = await db.all(reqTweetreplie)
    res.send({
      tweet: reqTweetLikeDb.tweet,
      likes: reqTweetLikeDb.likes,
      replies: reqTweetReplieDb.replies,
      dateTime: reqTweetLikeDb.date_time,
    })
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  verifyJWT,
  getUserId,
  getFollowing,
  checkTweet,
  async (req, res) => {
    const {tweetId} = req.params
    const returnTweet = `
      SELECT
        user.username
      FROM
        user INNER JOIN like ON user.user_id = like.user_id
      WHERE
        like.tweet_id = ${tweetId}
      `
    const reqTweetDb = await db.all(returnTweet)
    res.send({likes: reqTweetDb.map(each => each.username)})
  },
)
app.get(
  '/tweets/:tweetId/replies/',
  verifyJWT,
  getUserId,
  getFollowing,
  checkTweet,
  async (req, res) => {
    const {tweetId} = req.params
    const replyQuery = `
  SELECT
    user.name,
    reply.reply
  FROM
    user INNER JOIN reply ON user.user_id = reply.user_id
  WHERE
    reply.tweet_id = ${tweetId}
  `
    const replyDb = await db.all(replyQuery)
    res.send({
      replies: replyDb,
    })
  },
)

app.get('/user/tweets/', verifyJWT, getUserId, async (req, res) => {
  const {user_id} = req
  const reqTweetLikes = `
  SELECT
    tweet.tweet_id,
    tweet.tweet,
    COUNT(like.like_id) AS likes,
    tweet.date_time
  FROM
    tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE
    tweet.user_id = ${user_id}
  GROUP BY
    tweet.tweet_id
  `
  const getLikeDb = await db.all(reqTweetLikes)
  const reqTweetReplies = `
  SELECT
    tweet.tweet_id,
    COUNT(reply.reply_id) AS replies
  FROM
    tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
  WHERE
    tweet.user_id = ${user_id}
  GROUP BY
  tweet.tweet_id
  `
  const getReplyDb = await db.all(reqTweetReplies)
  const allSet = getLikeDb.map((each, index) => ({
    tweet: each.tweet,
    likes: each.likes,
    replies: getReplyDb.filter(eache => eache.tweet_id === each.tweet_id),
    dateTime: each.date_time,
  }))
  res.send(
    allSet.map(each => ({
      tweet: each.tweet,
      likes: each.likes,
      replies: each.replies[0].replies,
      dateTime: each.dateTime,
    })),
  )
})

app.post('/user/tweets/', verifyJWT, getUserId, async (req, res) => {
  const {user_id} = req
  const tweetDetails = req.body
  const {tweet} = tweetDetails
  const createTweet = `
  INSERT INTO
    tweet(tweet,user_id)
  VALUES(
    '${tweet}',
    ${user_id}
  )
  `
  await db.run(createTweet)
  res.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', verifyJWT, getUserId, async (req, res) => {
  const {tweetId} = req.params
  const {user_id} = req
  const userTweetIdsQuery = `
  SELECT
    tweet_id
  FROM
    tweet
  WHERE
    user_id = ${user_id}
  `
  const userTweetIds = await db.all(userTweetIdsQuery)
  const userTweetIdList = userTweetIds.map(each => each.tweet_id)
  if (userTweetIdList.includes(parseInt(tweetId))) {
    const delteQuery = `
    DELETE
    FROM
    tweet
    WHERE
    tweet_id = ${tweetId}
    `
    await db.run(delteQuery)
    res.send(`Tweet Removed`)
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
})

module.exports = app
