# Set up T1 Arc for local development

T1 Arc is an Android application built with React Native and Expo. It uses native Android modules, including SQLCipher, Health Connect and Wear OS components, so Expo Go cannot run the project.

## What you need

- Git
- Node.js 22
- JDK 21
- Android Studio with a current Android SDK
- an Android emulator or a physical Android device with USB debugging enabled

Windows is the main development environment today. The normal Expo and Gradle commands should also work on macOS and Linux, but those paths have had less testing.

## Get the code

```powershell
git clone https://github.com/gregorgregor25/t1-arc.git
Set-Location t1-arc
npm ci
```

## Check the project

```powershell
npm run quality
npx expo-doctor
```

`npm run quality` runs the TypeScript check and the automated test suite.

## Run the Android app

Start an emulator or connect a device, then confirm that ADB can see it:

```powershell
adb devices
```

Generate the native project and install a development build:

```powershell
npx expo run:android
```

The first build takes longer because Gradle downloads the Android dependencies. Later builds are normally much quicker.

## Configure a data source

The app opens without an account and includes a synthetic demo lab for exploring the interface. Personal data sources are configured from the Sources screen.

Current integrations include LibreLinkUp, Nightscout, xDrip+, Glooko and Android Health Connect. Availability and imported fields vary by source. T1 Arc is independent and is not endorsed by any of those services.

Use test accounts and synthetic records whenever possible. Do not commit credentials, exports, databases or screenshots containing private health information.

## Configure Tarv1s

Tarv1s uses bring your own key access to the OpenAI API.

1. Create an API key in an OpenAI project that you control.
2. Open **Insights**, then **Ask Tarv1s**.
3. Add the key when prompted.
4. Review the explanation of what will be shared before sending a question.

The key is kept in Android secure storage. It is not included in backups or logs. Some supported totals are calculated entirely on the phone, while broader questions can send a bounded evidence packet to the OpenAI Responses API after you tap Send.

API use is billed by OpenAI to the account that owns the key. Model availability and pricing can change, so check the current OpenAI documentation before relying on a particular model or cost.

## Wear OS

The repository includes a Wear OS companion, Tile, complications and three watch faces. A clean Expo prebuild attaches those Android projects to the generated build.

For a local private test build:

```powershell
$env:T1ARC_PRIVATE_TEST_BUILD = '1'
npx expo prebuild --platform android --clean
Set-Location android
.\gradlew.bat :app:assembleRelease `
  :wear:assembleRelease `
  :watchface-meridian:assembleRelease `
  :watchface-chronograph:assembleRelease `
  :watchface-orbit:assembleRelease
Set-Location ..
```

The private test signing path is for local sideloading only. Production releases require explicit release signing configuration.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Expo development server |
| `npm run android` | Generate and run the Android app |
| `npm run typecheck` | Check TypeScript without emitting files |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests while developing |
| `npm run quality` | Run the full TypeScript and test checks |

## Common problems

### Expo Go cannot open the project

This is expected. T1 Arc depends on native modules and must be installed as a development or release build.

### Gradle uses the wrong Java version

Set `JAVA_HOME` to a JDK 21 installation, then open a new terminal and check `java -version`.

### A physical device is not listed

Enable Developer options and USB debugging on the phone, accept the computer's debugging prompt, then run `adb devices` again.

### Windows reports a native path length error

Move the checkout to a shorter local path and rebuild.

## Next steps

- Read [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.
- Read [the privacy model](PRIVACY.md) before changing data storage or networking.
- See [the technical overview](TECHNICAL_OVERVIEW.md) for detailed behaviour and calculation rules.
