# Expo loads this class by its manifest string when background tasks start.
# The constructor annotation alone does not keep the enclosing class name.
-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader {
  public <init>();
}
