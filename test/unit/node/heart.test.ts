import { logger } from "@coder/logger"
import { readFile, writeFile, stat, utimes } from "fs/promises"
import { Heart, heartbeatTimer } from "../../../src/node/heart"
import { clean, mockLogger, tmpdir } from "../../utils/helpers"

const mockIsActive = (resolveTo: boolean) => jest.fn().mockResolvedValue(resolveTo)

describe("Heart", () => {
  const testName = "heartTests"
  let testDir = ""
  let heart: Heart

  beforeAll(async () => {
    mockLogger()
    await clean(testName)
    testDir = await tmpdir(testName)
  })
  beforeEach(() => {
    heart = new Heart(`${testDir}/shutdown.txt`, mockIsActive(true))
  })
  afterAll(() => {
    jest.restoreAllMocks()
  })
  afterEach(() => {
    jest.resetAllMocks()
    if (heart) {
      heart.dispose()
    }
  })
  it("should write to a file when given a valid file path", async () => {
    // Set up heartbeat file with contents
    const text = "test"
    const pathToFile = `${testDir}/file.txt`
    await writeFile(pathToFile, text)
    const fileContents = await readFile(pathToFile, { encoding: "utf8" })
    // Explicitly set the modified time to 0 so that we can check
    // that the file was indeed modified after calling heart.beat().
    // This works around any potential race conditions.
    // Docs: https://nodejs.org/api/fs.html#fspromisesutimespath-atime-mtime
    await utimes(pathToFile, 0, 0)

    expect(fileContents).toBe(text)

    heart = new Heart(pathToFile, mockIsActive(true))
    heart.beat()
    // HACK@jsjoeio - beat has some async logic but is not an async method
    // Therefore, we have to create an artificial wait in order to make sure
    // all async code has completed before asserting
    await new Promise((r) => setTimeout(r, 100))
    // Check that the heart wrote to the heartbeatFilePath and overwrote our text
    const fileContentsAfterBeat = await readFile(pathToFile, { encoding: "utf8" })
    expect(fileContentsAfterBeat).not.toBe(text)
    // Make sure the modified timestamp was updated.
    const fileStatusAfterEdit = await stat(pathToFile)
    expect(fileStatusAfterEdit.mtimeMs).toBeGreaterThan(0)
  })
  it("should log a warning when given an invalid file path", async () => {
    heart = new Heart(`fakeDir/fake.txt`, mockIsActive(false))
    heart.beat()
    // HACK@jsjoeio - beat has some async logic but is not an async method
    // Therefore, we have to create an artificial wait in order to make sure
    // all async code has completed before asserting
    await new Promise((r) => setTimeout(r, 100))
    expect(logger.warn).toHaveBeenCalled()
  })
  it("should be active after calling beat", () => {
    heart.beat()

    const isAlive = heart.alive()
    expect(isAlive).toBe(true)
  })
  it("should not be active after dispose is called", () => {
    heart.dispose()

    const isAlive = heart.alive()
    expect(isAlive).toBe(false)
  })
})

describe("heartbeatTimer", () => {
  beforeAll(() => {
    mockLogger()
  })
  afterAll(() => {
    jest.restoreAllMocks()
  })
  afterEach(() => {
    jest.resetAllMocks()
  })
  it("should call beat when isActive resolves to true", async () => {
    const isActive = true
    const mockIsActive = jest.fn().mockResolvedValue(isActive)
    const mockBeatFn = jest.fn()
    await heartbeatTimer(mockIsActive, mockBeatFn)
    expect(mockIsActive).toHaveBeenCalled()
    expect(mockBeatFn).toHaveBeenCalled()
  })
  it("should log a warning when isActive rejects", async () => {
    const errorMsg = "oh no"
    const error = new Error(errorMsg)
    const mockIsActive = jest.fn().mockRejectedValue(error)
    const mockBeatFn = jest.fn()
    await heartbeatTimer(mockIsActive, mockBeatFn)
    expect(mockIsActive).toHaveBeenCalled()
    expect(mockBeatFn).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(errorMsg)
  })
})
